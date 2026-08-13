import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator, BackHandler, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../data/local/database';
// @ts-ignore
import uuid from 'react-native-uuid';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalEstructuraPregunta from '../../../data/local/models/LocalEstructuraPregunta';
import LocalSeccion from '../../../data/local/models/LocalSeccion';
import LocalCaptura from '../../../data/local/models/LocalCaptura';
import { CatalogoOpcion } from '../../../data/local/models/CatalogoOpcion';
import { SurveyField } from '../../components/Surveys/SurveyField';
import { evaluate } from 'mathjs';
import { useNavigation } from '@react-navigation/native';
import LocalClientePendiente from '../../../data/local/models/LocalClientePendiente';
import type { NavegacionApp, RutaDe } from '../../navigation/types';
import {
  leerRaw,
  comoTexto,
  type RawPregunta,
  type RawCaptura,
  type RawCatalogoOpcion,
} from '../../../data/local/types/raw.types';
import { parsearReglaValidacion, validarValor } from '../../../domain/validacion/reglaValidacion';
import { aPreguntaEncuesta } from '../../../data/local/adapters/preguntaAdapter';
import type { PreguntaEncuesta } from '../../../domain/encuesta/tipos';
import { esTipoCalculo, esTipoLabel, esTipoMatriz } from '../../../domain/encuesta/tipos';
import { parseNumeroLocal } from '../../../domain/encuesta/numeros';
import { resolverIdDesdeToken, sanearTokenQEnJSON } from '../../../domain/encuesta/tokens';
import { evaluarVisibilidad } from '../../../domain/encuesta/visibilidad';
import { aplicarCalculos as calcularDominio } from '../../../domain/encuesta/calculo';
import { limpiarDescendientesDeCascada } from '../../../domain/encuesta/cascada';
import {
  obtenerOpciones as obtenerOpcionesDominio,
  obtenerArbolOpciones as obtenerArbolOpcionesDominio,
} from '../../../domain/encuesta/catalogos';
import { aOpcionCatalogo } from '../../../data/local/adapters/preguntaAdapter';
import * as ImagePicker from 'expo-image-picker';
import { consumirCapturaPendiente } from '../../../data/local/services/capturaPendiente';
import { registrarArchivoLocal } from '../../../data/local/services/multimedia.service';

// `NodoOpcionArbol`, `resolverNombreCatalogo` y `esOrigenApiPregunta` se eliminaron en
// el Sprint 11: sus equivalentes viven en `domain/encuesta/catalogos.ts` (`NodoOpcion`
// y `nombreCatalogoDe`), ya con pruebas.

interface Props {
  route: RutaDe<'DynamicSurvey'>;
  encuesta: LocalEncuesta | null;
  preguntas: LocalEstructuraPregunta[];
  secciones: LocalSeccion[];
  catalogos: CatalogoOpcion[];
  capturasExistentes: LocalCaptura[];
}

const DynamicSurvey = ({ route, encuesta, preguntas, secciones, catalogos, capturasExistentes }: Props) => {
  const navigation = useNavigation<NavegacionApp>();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [instanciasMatriz, setInstanciasMatriz] = useState<Record<string, string[]>>({});

  /**
   * Preguntas aplanadas al contrato del dominio. El motor (visibilidad, cálculo,
   * catálogos) trabaja sobre estos objetos planos y NO sobre los modelos de
   * WatermelonDB: esa es la razón por la que se puede probar con Node plano.
   * Se memoiza para no reconstruirlos en cada render.
   */
  const preguntasDominio = useMemo<PreguntaEncuesta[]>(
    () => preguntas.map(aPreguntaEncuesta),
    [preguntas],
  );

  /**
   * Opciones de catalogo aplanadas al contrato del dominio. Se memoiza porque la
   * lista completa puede tener miles de filas y se recorre en cada render de cada
   * pregunta de tipo SELECT.
   */
  const catalogosDominio = useMemo(() => catalogos.map(aOpcionCatalogo), [catalogos]);

  /** Acceso por id, para traducir un modelo a su equivalente de dominio. */
  const dominioPorId = useMemo(() => {
    const mapa = new Map<string, PreguntaEncuesta>();
    preguntasDominio.forEach(p => mapa.set(p.id, p));
    return mapa;
  }, [preguntasDominio]);

  /** Traduce un modelo a su forma de dominio (aplana al vuelo si aún no está en el mapa). */
  const aDominio = (p: LocalEstructuraPregunta): PreguntaEncuesta =>
    dominioPorId.get(String(p.id)) ?? aPreguntaEncuesta(p);
  const [seccionExpandidaId, setSeccionExpandidaId] = useState<string | null>(null);

  // A. Decisión Arquitectónica de Telemetría: Estado local para capturar el instante exacto en que se monta la vista.
  // Permite evaluar el rendimiento de los encuestadores midiendo la duración de la sesión.
  const [fechaInicioAuditoria, setFechaInicioAuditoria] = useState<string>(() => new Date().toISOString());
  const [seccionesAbiertas, setSeccionesAbiertas] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (secciones && secciones.length > 0) {
      setSeccionesAbiertas({ [secciones[0].id]: true });
    }
  }, [secciones]);

  /**
   * Recupera la foto cuando Android destruyó el proceso mientras la cámara estaba
   * abierta — escenario real en gama baja, donde el sistema mata la aplicación de
   * fondo porque la cámara consume mucha memoria.
   *
   * Al volver, la foto SÍ se tomó, pero la promesa de `launchCameraAsync` murió con el
   * proceso: sin esto se pierde en silencio y el asesor jura haberla tomado.
   *
   * POR QUÉ VIVE EN LA PANTALLA Y NO EN EL CAMPO
   * `getPendingResultAsync()` entrega el resultado huérfano pero NO dice qué pregunta
   * lo pidió. Resolverlo en `CampoMultimedia` asignaría la foto al primer campo que se
   * monte, que casi nunca es el correcto. La coordenada se anotó antes de abrir la
   * cámara (`anotarCapturaPendiente`) y aquí se consume una sola vez, en el arranque.
   *
   * Se ejecuta sin dependencias a propósito: solo tiene sentido una vez por montaje.
   */
  useEffect(() => {
    const recuperarFotoHuerfana = async () => {
      try {
        const pendiente = await ImagePicker.getPendingResultAsync();
        if (!pendiente) return;

        // La nota se consume SIEMPRE, haya foto o no: si sobreviviera, reasignaría
        // una foto vieja a la siguiente pregunta que usara la cámara — un error mucho
        // peor y prácticamente indetectable.
        const contexto = await consumirCapturaPendiente();

        const resultados = Array.isArray(pendiente) ? pendiente : [pendiente];
        const conFoto = resultados.find(
          (r): r is ImagePicker.ImagePickerSuccessResult =>
            'assets' in r && Array.isArray(r.assets) && r.assets.length > 0,
        );
        if (!conFoto || !contexto) return;

        // Solo se acepta si corresponde a ESTA instancia de captura: el usuario pudo
        // haber abierto otra encuesta entretanto.
        if (contexto.uuidBase !== instanciaEncuestaUuid) {
          console.warn('⚠️ [Multimedia] Foto huérfana de otra instancia; se descarta.');
          return;
        }

        const activo = conFoto.assets[0];
        const registrado = await registrarArchivoLocal(contexto, 'FOTO', {
          uri: activo.uri,
          nombre: activo.fileName,
          mimeType: activo.mimeType,
          tamanio: activo.fileSize ?? null,
        });

        // Misma convencion de clave que usa el resto de la pantalla.
        const clave = contexto.uuidFila
          ? `${contexto.idPregunta}_${contexto.uuidFila}`
          : contexto.idPregunta;
        handleRespuestaChange(clave, registrado.token);

        Alert.alert(
          'Fotografía recuperada',
          'La aplicación se cerró mientras tomaba la fotografía, pero se recuperó y ya está adjunta.',
        );
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️ [Multimedia] No se pudo recuperar la foto pendiente: ${detalle}`);
      }
    };

    void recuperarFotoHuerfana();
  }, []);

  const scrollViewRef = useRef<ScrollView>(null);
  const sectionRefs = useRef<Record<string, View | null>>({});
  const puedeSalir = useRef(false);

  // Se sustituye el useState por un useRef para almacenar las coordenadas "Y" de forma silenciosa.
  const seccionLayoutsRef = useRef<Record<string, number>>({});

  /** Margen por encima del encabezado para que no quede pegado al borde superior. */
  const MARGEN_SCROLL = 12;

  /**
   * Sección cuyo scroll está pendiente de ejecutarse. El desplazamiento NO se hace
   * en el onPress, sino en el `onLayout` de la propia sección (ver más abajo).
   *
   * Por qué así: al abrir una sección, la que estaba abierta se COLAPSA y todo lo
   * que hay debajo sube cientos de píxeles. Cualquier intento de leer la posición
   * en el momento del tap —con un setTimeout fijo o con la Y cacheada— usa el
   * layout ANTERIOR y aterriza a media sección o más abajo.
   *
   * `onLayout` se dispara justo cuando el layout ya se recalculó y trae la Y buena,
   * así que es el único momento fiable. Tampoco usa `measureLayout`: con la Nueva
   * Arquitectura (Fabric) éste rechaza el número de `findNodeHandle` y falla con
   * "measureLayout must be called with a ref to a native component".
   */
  const scrollPendienteRef = useRef<string | null>(null);

  const desplazarASeccion = (idSeccion: string) => {
    scrollPendienteRef.current = idSeccion;
    // Ventana de gracia: mientras siga pendiente, cada onLayout de esa sección
    // vuelve a corregir la posición (los SELECT y matrices pesados asientan su
    // layout en varias pasadas). Pasado ese margen se deja de reposicionar para
    // no pelear con el scroll manual del encuestador.
    setTimeout(() => {
      if (scrollPendienteRef.current === idSeccion) scrollPendienteRef.current = null;
    }, 600);
  };

  /** Llamado desde el onLayout de cada sección, con la Y ya recalculada. */
  const registrarLayoutSeccion = (idSeccion: string, y: number) => {
    seccionLayoutsRef.current[idSeccion] = y;
    if (scrollPendienteRef.current !== idSeccion) return;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y - MARGEN_SCROLL), animated: true });
  };

  // Extraído del router para evitar colapsos si el modelo 'encuesta' está en la fase de carga
  const idEncuestaSeguro = route?.params?.idEncuesta || '';

  // Se declara y extrae formalmente la variable del token del cliente
  const uuidInstanciaBase = route?.params?.uuidInstanciaBase || '';
  const instanciaEncuestaUuid = uuidInstanciaBase || uuid.v4().toString();

  // --- MOTOR DE RESTAURACIÓN DE BORRADORES ---
  // La restauración corre UNA sola vez: el auto-save re-escribe local_captura y el
  // observable re-emitiría, pisando lo que el asesor está tecleando en ese momento.
  const restauradoRef = useRef(false);
  useEffect(() => {
    if (restauradoRef.current) return;
    if (capturasExistentes) restauradoRef.current = true;
    if (capturasExistentes && capturasExistentes.length > 0) {
      const mapaRespuestas: Record<string, string> = {};
      const mapaMatrices: Record<string, string[]> = {};

      // Búsqueda de telemetría de auditoría: se recupera la marca de tiempo de inicio original del borrador
      // para evitar que se sobreescriba en reingresos subsecuentes al mismo formulario.
      const fechaInicioPrevio = capturasExistentes.find(cap => cap.fecha_inicio)?.fecha_inicio ||
        capturasExistentes.map(cap => leerRaw<RawCaptura>(cap)).find(raw => !!raw.fecha_inicio)?.fecha_inicio;
      if (fechaInicioPrevio) {
        setFechaInicioAuditoria(fechaInicioPrevio);
      }

      capturasExistentes.forEach((cap) => {
        const raw = leerRaw<RawCaptura>(cap);
        const idPregunta = comoTexto(raw.id_pregunta);
        const uuidInstancia = comoTexto(raw.uuid_instancia);

        const partesUuid = uuidInstancia.split('_');
        const uuidFila = partesUuid[1] || null;

        const llaveEstado = uuidFila ? `${idPregunta}_${uuidFila}` : idPregunta;
        mapaRespuestas[llaveEstado] = raw.valor || '';

        if (uuidFila) {
          const preguntaObj = preguntas.find(p => p.id === idPregunta);
          const idMatrizPadre = preguntaObj?.id_matriz_padre;
          if (idMatrizPadre && idMatrizPadre !== 'null') {
            if (!mapaMatrices[idMatrizPadre]) mapaMatrices[idMatrizPadre] = [];
            if (!mapaMatrices[idMatrizPadre].includes(uuidFila)) {
              mapaMatrices[idMatrizPadre].push(uuidFila);
            }
          }
        }
      });

      // Se recalculan los campos CALCULO con las fuentes restauradas para que
      // aparezcan ya resueltos al reabrir un borrador (sin necesidad de re-editar).
      // Se pasan las matrices recién reconstruidas porque el estado aún no las tiene.
      setRespuestas(aplicarCalculos(mapaRespuestas, mapaMatrices));
      setInstanciasMatriz(mapaMatrices);
    }
  }, [capturasExistentes]);

  // VALIDADOR REACTIVO DE CAMPOS VACÍOS
  const tieneDatosLlenos = () => {
    return Object.values(respuestas).some(val => val && val.toString().trim() !== '');
  };

  /**
   * Decisión única de salida, compartida por los tres puntos por los que el
   * encuestador puede abandonar la pantalla (gesto/navegación de React
   * Navigation, botón físico de Android y la flecha del header). Sin datos
   * capturados sale directo; con datos, pide confirmación de pausa. Antes la
   * flecha del header abría el modal SIEMPRE, sin esta comprobación.
   */
  const intentarSalir = (salirDirecto: () => void) => {
    if (!tieneDatosLlenos()) {
      puedeSalir.current = true;
      salirDirecto();
      return;
    }
    setShowPauseModal(true);
  };

  // INTERCEPTOR DE SALIDA PARA REACT NAVIGATION
  useEffect(() => {
    const interceptarSalida = navigation.addListener('beforeRemove', (e: any) => {
      if (puedeSalir.current) return;
      if (!tieneDatosLlenos()) {
        puedeSalir.current = true;
        navigation.dispatch(e.data.action);
        return;
      }
      e.preventDefault();
      setShowPauseModal(true);
    });
    return interceptarSalida;
  }, [navigation, respuestas]);

  // INTERCEPTOR CORREGIDO PARA BOTÓN FISICO (ANDROID)
  useEffect(() => {
    const backAction = () => {
      intentarSalir(() => navigation.goBack());
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [navigation, respuestas]);

  const añadirFilaMatriz = (idPadre: string) => {
    const nuevoUuid = uuid.v4().toString();
    setInstanciasMatriz(prev => ({ ...prev, [idPadre]: [...(prev[idPadre] || []), nuevoUuid] }));
  };

  const eliminarFilaMatriz = (idPadre: string, uuidEliminar: string) => {
    setInstanciasMatriz(prev => ({ ...prev, [idPadre]: prev[idPadre].filter(id => id !== uuidEliminar) }));

    // Purga las respuestas de esa fila del estado y de WatermelonDB para no dejar huérfanos.
    const hijas = preguntas.filter(h => String(h.id_matriz_padre) === String(idPadre));
    const keysFila = hijas.map(h => `${h.id}_${uuidEliminar}`);
    setRespuestas(prev => {
      const copia = { ...prev };
      keysFila.forEach(k => { delete copia[k]; });
      return copia;
    });
    purgarCapturasPersistidas(keysFila);
  };

  /**
   * Visibilidad de una pregunta. La lógica vive en `domain/encuesta/visibilidad`
   * (probada con 21 casos); aquí solo se traduce el modelo al contrato del dominio
   * y se registra el aviso cuando el BackOffice manda una regla inválida.
   */
  const isQuestionVisible = (
    p: LocalEstructuraPregunta,
    uuidFila?: string | null,
    snap: Record<string, string> = respuestas,
  ): boolean => {
    const resultado = evaluarVisibilidad(aDominio(p), preguntasDominio, snap, uuidFila);
    if (resultado.errorRegla) {
      console.warn(`[VISIBILIDAD] Regla inválida en "${p.etiqueta}":`, p.regla_visibilidad, resultado.errorRegla);
    }
    return resultado.visible;
  };


  const getSeccionStatusColor = (idSeccion: string) => {
    //const pregSeccion = preguntas.filter(p => p.id_seccion === idSeccion && (!p.id_matriz_padre || p.id_matriz_padre === 'null'));
    const pregSeccion = preguntas.filter(p =>
      String(p.id_seccion) === String(idSeccion) &&
      (!p.id_matriz_padre || String(p.id_matriz_padre).toLowerCase() === 'null' || String(p.id_matriz_padre) === '')
    );

    if (pregSeccion.length === 0) return 'bg-gray-200';
    let totalObligatorias = 0;
    let obligatoriasLlenas = 0;
    let algunaRespondida = false;

    pregSeccion.forEach(p => {
      if (!isQuestionVisible(p)) return;
      if (esTipoLabel(p.tipo_dato)) return; // Informativo: no cuenta para el progreso
      if (p.tipo_dato?.toUpperCase() === 'MATRIZ') {
        const hijas = preguntas.filter(h => String(h.id_matriz_padre) === String(p.id));
        const filas = instanciasMatriz[p.id] || [];
        if (filas.length > 0) algunaRespondida = true;

        filas.forEach(uuidFila => {
          hijas.forEach(hija => {
            if (!isQuestionVisible(hija, uuidFila)) return;
            const val = respuestas[`${hija.id}_${uuidFila}`];
            const lleno = val && String(val).trim() !== '' && val !== '[]';

            if (hija.es_obligatorio === 1) {
              totalObligatorias++;
              if (lleno) obligatoriasLlenas++;
            } else if (lleno) algunaRespondida = true;
          });
        });
      } else {
        const val = respuestas[p.id];
        const lleno = val && val.trim() !== '';
        if (lleno) algunaRespondida = true;
        if (p.es_obligatorio === 1) {
          totalObligatorias++;
          if (lleno) obligatoriasLlenas++;
        }
      }
    });
    if (totalObligatorias > 0 && obligatoriasLlenas === totalObligatorias) return 'bg-[#10B981]'; // Verde (Todo lo obligatorio está lleno)
    if (totalObligatorias === 0 && algunaRespondida) return 'bg-[#10B981]'; // Verde (No hay obligatorias, pero sí respondió opcionales)
    if (obligatoriasLlenas > 0 || algunaRespondida) return 'bg-[#F59E0B]'; // Naranja (A medias)
    return 'bg-gray-200'; // Gris
  };

  /**
   * Motor de cálculo. La lógica vive en `domain/encuesta/calculo` (14 casos de prueba,
   * incluidos los corchetes de mathjs, el cálculo por fila de matriz y el
   * encadenamiento). Aquí solo se traducen los tipos y se registran los avisos.
   */
  const aplicarCalculos = (
    base: Record<string, string>,
    matrices: Record<string, string[]> = instanciasMatriz,
  ): Record<string, string> => {
    const { respuestas: calculadas, avisos } = calcularDominio(base, preguntasDominio, matrices);
    avisos.forEach(a => console.warn(`[CALCULO] ${a.etiqueta}: ${a.mensaje}`));
    return calculadas;
  };


  /**
   * Recorre todas las preguntas y elimina del estado las respuestas de los elementos
   * que quedan OCULTOS según la visibilidad evaluada sobre `base`. Itera a punto fijo
   * porque ocultar un controlador puede ocultar en cascada a sus dependientes.
   * Devuelve los mapas purgados y las claves de estado eliminadas (para borrarlas
   * también en WatermelonDB y no enviar cargas huérfanas al backend).
   */
  const purgarOcultos = (
    base: Record<string, string>,
    matrices: Record<string, string[]>
  ): { respuestas: Record<string, string>; matrices: Record<string, string[]>; keysEliminadas: string[] } => {
    const resultado = { ...base };
    const matricesResult = { ...matrices };
    const keysEliminadas: string[] = [];

    const borrarClave = (key: string) => {
      if (resultado[key] === undefined) return false;
      if (resultado[key] !== '') keysEliminadas.push(key);
      delete resultado[key];
      return true;
    };

    let huboCambios = true;
    let iteraciones = 0;
    while (huboCambios && iteraciones < 5) {
      huboCambios = false;
      iteraciones++;

      preguntas
        .filter(p => !p.id_matriz_padre || String(p.id_matriz_padre).toLowerCase() === 'null' || String(p.id_matriz_padre) === '')
        .forEach(p => {
          const esMatriz = p.tipo_dato?.toUpperCase() === 'MATRIZ';

          if (esMatriz) {
            const filas = matricesResult[p.id] || [];
            const hijas = preguntas.filter(h => String(h.id_matriz_padre) === String(p.id));

            if (!isQuestionVisible(p, undefined, resultado)) {
              // Matriz completa oculta: purgar todas sus filas e instancias.
              filas.forEach(uuidFila => {
                hijas.forEach(hija => { if (borrarClave(`${hija.id}_${uuidFila}`)) huboCambios = true; });
              });
              if (matricesResult[p.id] && matricesResult[p.id].length > 0) {
                matricesResult[p.id] = [];
                huboCambios = true;
              }
            } else {
              // Matriz visible: purgar solo las hijas ocultas por fila (row-scoped).
              filas.forEach(uuidFila => {
                hijas.forEach(hija => {
                  if (!isQuestionVisible(hija, uuidFila, resultado)) {
                    if (borrarClave(`${hija.id}_${uuidFila}`)) huboCambios = true;
                  }
                });
              });
            }
          } else if (!isQuestionVisible(p, undefined, resultado)) {
            if (borrarClave(p.id)) huboCambios = true;
          }
        });
    }

    return { respuestas: resultado, matrices: matricesResult, keysEliminadas };
  };

  /**
   * Elimina de WatermelonDB las capturas de claves ya purgadas (best-effort). Cubre el
   * caso de un borrador pausado en disco que se reabre y se oculta.
   */
  const purgarCapturasPersistidas = async (keys: string[]) => {
    if (!keys || keys.length === 0) return;
    try {
      const capturaCollection = database.collections.get<LocalCaptura>('local_captura');
      const aBorrar: LocalCaptura[] = [];

      for (const key of keys) {
        const partes = key.split('_');
        const idPregunta = partes[0];
        const uuidFila = partes[1] || null;
        const uuidInstancia = uuidFila ? `${instanciaEncuestaUuid}_${uuidFila}` : instanciaEncuestaUuid;

        const filas = await capturaCollection.query(
          Q.where('uuid_instancia', uuidInstancia),
          Q.where('id_pregunta', idPregunta)
        ).fetch();
        aBorrar.push(...filas);
      }

      if (aBorrar.length > 0) {
        await database.write(async () => {
          await database.batch(...aBorrar.map(r => r.prepareDestroyPermanently()));
        });
      }
    } catch (e) {
      console.warn('[PURGA] No se pudieron eliminar capturas huérfanas:', e);
    }
  };

  const handleRespuestaChange = (idPregunta: string, valor: string) => {
    // La clave puede venir acotada a una fila de matriz ("<id>_<uuidFila>").
    const [idBase, uuidFila] = idPregunta.split('_');

    // Al cambiar el padre de una cascada hay que limpiar a sus descendientes: la regla
    // `dependeDeCatalogo` solo exige que el padre tenga ALGUNA respuesta, así que el
    // hijo no se oculta y `purgarOcultos` no lo alcanza. Sin esto, cambiar de
    // Departamento dejaba guardado un Municipio del departamento anterior — un dato
    // que parece válido y viajaría al servidor.
    const { respuestas: sinDescendientes, clavesLimpiadas } = limpiarDescendientesDeCascada(
      idBase,
      respuestas[idPregunta],
      valor,
      respuestas,
      preguntasDominio,
      uuidFila || null,
    );

    const calculadas = aplicarCalculos({ ...sinDescendientes, [idPregunta]: valor });
    const { respuestas: purgadas, matrices, keysEliminadas } = purgarOcultos(calculadas, instanciasMatriz);
    setRespuestas(purgadas);
    setInstanciasMatriz(matrices);

    const aPurgar = [...clavesLimpiadas, ...keysEliminadas];
    if (aPurgar.length > 0) purgarCapturasPersistidas(aPurgar);
  };

  /**
   * Persistencia unificada de la instancia (usada por auto-save, pausar y finalizar):
   * borra las filas previas de esta instancia y las recrea desde el mapa de respuestas,
   * haciendo upsert de la tarjeta en la agenda (local_cliente_pendiente).
   * - estadoSincro: -1 borrador (auto-save/pausa) | 0 finalizada/pendiente de envío.
   * - estadoGestionCliente: 0 visible en agenda | 1 completada.
   */
  const persistirCapturas = async (
    mapa: Record<string, string>,
    estadoSincro: number,
    fechaFin: string | null,
    estadoGestionCliente: number
  ) => {
    await database.write(async () => {
      const capturaCollection = database.collections.get<LocalCaptura>('local_captura');
      const borradoresPrevios = await capturaCollection.query(
        Q.where('id_encuesta', idEncuestaSeguro),
        Q.where('uuid_instancia', Q.like(`${instanciaEncuestaUuid}%`))
      ).fetch();
      const registrosABorrar = borradoresPrevios.map(r => r.prepareDestroyPermanently());

      const batchCreate = Object.entries(mapa)
        .filter(([_, valor]) => valor !== '')
        // Los informativos no capturan. Se filtran por si quedó un valor heredado
        // de cuando esa pregunta era de otro tipo en el BackOffice: sin esto, un
        // borrador antiguo lo restauraría y acabaría viajando a /surveys/submit.
        .filter(([key]) => {
          const idPregunta = key.split('_')[0];
          const pregunta = preguntas.find(p => String(p.id) === idPregunta);
          return !esTipoLabel(pregunta?.tipo_dato);
        })
        .map(([key, valor]) => {
          const partes = key.split('_');
          const idPregunta = partes[0];
          const uuidFila = partes[1] || null;

          return capturaCollection.prepareCreate((record) => {
            record.id_encuesta = idEncuestaSeguro;
            record.id_pregunta = idPregunta;
            record.valor = valor;
            record.uuid_instancia = uuidFila ? `${instanciaEncuestaUuid}_${uuidFila}` : instanciaEncuestaUuid;
            record.estado_sincro = estadoSincro;
            record.fecha_inicio = fechaInicioAuditoria;
            record.fecha_fin = fechaFin;
          });
        });

      // Upsert de la tarjeta en la agenda con el nombre detectado del formulario.
      const clientePendienteCollection = database.collections.get<LocalClientePendiente>('local_cliente_pendiente');
      const existeCliente = await clientePendienteCollection.query(
        Q.where('id_cliente', instanciaEncuestaUuid)
      ).fetch();

      /**
       * Nombre que identifica la tarjeta en la agenda.
       *
       * La versión anterior usaba un solo `find` con un OR: devolvía la PRIMERA
       * pregunta cuya etiqueta contuviera "nombre", aunque más abajo existiera una
       * llamada exactamente "Nombre Completo". En un formulario con "Nombre del
       * negocio" antes que "Nombre Completo" se elegía la equivocada y, si esa estaba
       * vacía, la tarjeta se quedaba en "NUEVA ENCUESTA" para siempre.
       *
       * Ahora se recorre por PRIORIDAD y se exige que la respuesta tenga contenido:
       * una coincidencia peor con dato real es más útil que la mejor coincidencia
       * vacía. Las etiquetas se comparan sin acentos ni mayúsculas.
       */
      const PRIORIDAD_ETIQUETAS = ['nombre completo', 'nombre del cliente', 'nombres', 'nombre'];

      const normalizar = (texto: string): string =>
        texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

      /** Respuesta de una pregunta, mirando también la primera fila si es de matriz. */
      const respuestaDe = (idPregunta: string): string => {
        const directa = mapa[idPregunta];
        if (directa && directa.trim() !== '') return directa.trim();
        // Clave compuesta `<idPregunta>_<uuidFila>` cuando la pregunta vive en una matriz.
        const claveEnMatriz = Object.keys(mapa).find(k => k.startsWith(`${idPregunta}_`));
        const enMatriz = claveEnMatriz ? mapa[claveEnMatriz] : '';
        return enMatriz && enMatriz.trim() !== '' ? enMatriz.trim() : '';
      };

      let nombreDetectado = 'NUEVA ENCUESTA';
      for (const clave of PRIORIDAD_ETIQUETAS) {
        const candidata = preguntas.find(p => normalizar(p.etiqueta || '').includes(clave));
        if (!candidata) continue;
        const valorNombre = respuestaDe(String(candidata.id));
        if (valorNombre !== '') {
          // Se recorta: un nombre larguísimo rompe el diseño de la tarjeta.
          nombreDetectado = valorNombre.length > 60 ? valorNombre.slice(0, 60) : valorNombre;
          break;
        }
      }

      console.log(`🏷️ [AGENDA] Nombre de la tarjeta: "${nombreDetectado}"`);

      if (existeCliente.length === 0) {
        const nuevoCliente = clientePendienteCollection.prepareCreate((record) => {
          record.id_cliente = instanciaEncuestaUuid;
          record.nombre = nombreDetectado;
          record.codigo = 'AD-HOC';
          record.id_encuesta = idEncuestaSeguro;
          record.estado_gestion = estadoGestionCliente;
          record.motivo_rechazo = null;
        });
        await database.batch([...registrosABorrar, ...batchCreate, nuevoCliente] as any[]);
      } else {
        const clienteActualizado = existeCliente[0].prepareUpdate((record) => {
          record.nombre = nombreDetectado;
          record.estado_gestion = estadoGestionCliente;
        });
        await database.batch([...registrosABorrar, ...batchCreate, clienteActualizado] as any[]);
      }
    });
  };

  // --- AUTO-SAVE (S3.3): persiste el borrador tras cada cambio, con debounce, para
  // que un cierre inesperado de la app no pierda datos. cierreEnCursoRef evita que un
  // timer pendiente re-escriba como borrador una encuesta que se está finalizando.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cierreEnCursoRef = useRef(false);
  useEffect(() => {
    if (!tieneDatosLlenos()) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const snapshot = respuestas;
    autoSaveTimerRef.current = setTimeout(() => {
      if (cierreEnCursoRef.current || puedeSalir.current) return;
      persistirCapturas(snapshot, -1, null, 0).catch(e => console.warn('[AUTOSAVE] Falló el guardado automático:', e));
    }, 1500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [respuestas]);

  const handlePausarFormulario = async () => {
    setIsSaving(true);
    cierreEnCursoRef.current = true;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    try {
      await persistirCapturas(respuestas, -1, null, 0);
      puedeSalir.current = true;
      setShowPauseModal(false);
      navigation.goBack();
    } catch (error) {
      cierreEnCursoRef.current = false;
      Alert.alert("Error", "No se pudo suspender la encuesta de forma segura.");
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Regla S4.4 / EnviarEncuesta: no se puede finalizar con (a) obligatorios
   * VISIBLES vacíos, ni (b) valores que incumplan su regla_validacion (regex,
   * máscara o DSL) — antes solo se comprobaba (a); un email mal escrito o un
   * DPI incompleto pasaban sin bloquear el envío. Row-aware: dentro de una
   * matriz solo cuentan las hijas visibles de cada fila. Reusa el mismo
   * intérprete de reglas que SurveyField (parsearReglaValidacion/validarValor)
   * para no duplicar la lógica de validación.
   */
  const validarEncuesta = (): { faltantes: string[]; invalidos: string[] } => {
    const seccionesFaltantes: string[] = [];
    const seccionesInvalidas: string[] = [];

    const revisarPregunta = (p: LocalEstructuraPregunta, valor: string | undefined): 'ok' | 'faltante' | 'invalido' => {
      // Los informativos no se llenan: aunque el BackOffice los marque obligatorios
      // por error, no deben bloquear el cierre de la encuesta.
      if (esTipoLabel(p.tipo_dato)) return 'ok';
      const vacio = !valor || String(valor).trim() === '' || valor === '[]';
      if (p.es_obligatorio === 1 && vacio) return 'faltante';
      if (vacio) return 'ok'; // opcional y vacío: nada que validar
      const regla = parsearReglaValidacion(p.regla_validacion);
      return validarValor(String(valor), regla).valido ? 'ok' : 'invalido';
    };

    secciones.forEach(seccion => {
      const pregSeccion = preguntas.filter(p =>
        String(p.id_seccion) === String(seccion.id) &&
        (!p.id_matriz_padre || String(p.id_matriz_padre).toLowerCase() === 'null' || String(p.id_matriz_padre) === '')
      );

      let faltantes = 0;
      let invalidos = 0;
      pregSeccion.forEach(p => {
        if (!isQuestionVisible(p)) return;

        if (p.tipo_dato?.toUpperCase() === 'MATRIZ') {
          const hijas = preguntas.filter(h => String(h.id_matriz_padre) === String(p.id));
          const filas = instanciasMatriz[p.id] || [];
          filas.forEach(uuidFila => {
            hijas.forEach(hija => {
              if (!isQuestionVisible(hija, uuidFila)) return;
              const resultado = revisarPregunta(hija, respuestas[`${hija.id}_${uuidFila}`]);
              if (resultado === 'faltante') faltantes++;
              else if (resultado === 'invalido') invalidos++;
            });
          });
        } else {
          const resultado = revisarPregunta(p, respuestas[p.id]);
          if (resultado === 'faltante') faltantes++;
          else if (resultado === 'invalido') invalidos++;
        }
      });

      if (faltantes > 0) {
        seccionesFaltantes.push(`• ${seccion.nombre || 'Sección'} (${faltantes} campo${faltantes > 1 ? 's' : ''})`);
      }
      if (invalidos > 0) {
        seccionesInvalidas.push(`• ${seccion.nombre || 'Sección'} (${invalidos} campo${invalidos > 1 ? 's' : ''})`);
      }
    });

    return { faltantes: seccionesFaltantes, invalidos: seccionesInvalidas };
  };

  const handleFinalizarFormulario = async () => {
    // Bloqueo por integridad: obligatorios visibles sin responder o con formato inválido.
    const { faltantes, invalidos } = validarEncuesta();
    if (faltantes.length > 0 || invalidos.length > 0) {
      const partes: string[] = [];
      if (faltantes.length > 0) {
        partes.push(`Campos obligatorios sin responder:\n${faltantes.join('\n')}`);
      }
      if (invalidos.length > 0) {
        partes.push(`Campos con formato inválido:\n${invalidos.join('\n')}`);
      }
      Alert.alert("Encuesta incompleta", partes.join('\n\n'));
      return;
    }

    setIsSaving(true);
    cierreEnCursoRef.current = true;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    // Telemetría de auditoría: hora exacta de cierre del formulario.
    const fechaFinAuditoria = new Date().toISOString();
    try {
      await persistirCapturas(respuestas, 0, fechaFinAuditoria, 1);
      puedeSalir.current = true;
      Alert.alert("¡Éxito!", "Gestión completada.", [{ text: "Finalizar", onPress: () => navigation.goBack() }]);
    } catch (error) {
      cierreEnCursoRef.current = false;
      Alert.alert("Error", "No se pudo guardar la captura final.");
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Envoltorios delgados sobre `domain/encuesta/catalogos`.
   *
   * La resolucion de opciones vive en el dominio desde el Sprint 11: eran las dos
   * funciones que mas fallos habian producido en el proyecto y no se podian probar
   * sin emulador. Aqui solo queda traducir modelos a contratos y serializar para
   * `SurveyField`, que recibe las opciones como JSON.
   *
   * El `null` del dominio se traduce a cadena vacia, que es como la pantalla senala
   * "catalogo no disponible offline"; un `[]` significa "hay fuente, pero ninguna
   * opcion aplica". Colapsar ambos casos cambiaria lo que ve el asesor.
   */
  const obtenerOpciones = (p: LocalEstructuraPregunta, uuidFila?: string | null): string => {
    const valores = obtenerOpcionesDominio(
      aDominio(p), catalogosDominio, respuestas, preguntasDominio, uuidFila,
    );
    return valores === null ? '' : JSON.stringify(valores);
  };

  const obtenerArbolOpciones = (p: LocalEstructuraPregunta, uuidFila?: string | null): string => {
    const arbol = obtenerArbolOpcionesDominio(
      aDominio(p), catalogosDominio, respuestas, preguntasDominio, uuidFila,
    );
    return arbol === null ? '' : JSON.stringify(arbol);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200">
        <TouchableOpacity onPress={() => intentarSalir(() => navigation.goBack())}>
          <Feather name="arrow-left" size={24} color="#374151" />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text className="text-[#1E3A8A] font-bold text-lg">{encuesta ? encuesta.nombre.toUpperCase() : 'CARGANDO...'}</Text>
        </View>
      </View>

      <ScrollView className="flex-1 p-4" ref={scrollViewRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {secciones.map((seccion) => {
          const estaAbierta = seccionExpandidaId === seccion.id;
          //const preguntasRaiz = preguntas.filter(p => p.id_seccion === seccion.id && (!p.id_matriz_padre || p.id_matriz_padre === 'null'));
          const preguntasRaiz = preguntas.filter(p =>
            String(p.id_seccion) === String(seccion.id) &&
            (!p.id_matriz_padre || String(p.id_matriz_padre).toLowerCase() === 'null' || String(p.id_matriz_padre) === '')
          );
          if (preguntasRaiz.length === 0) return null;

          return (
            <View key={seccion.id} ref={el => { sectionRefs.current[seccion.id] = el; }}
              onLayout={(e) => {
                // Se escribe en la referencia en lugar del estado para no disparar ciclos
                // prematuros, y se aprovecha para ejecutar el scroll pendiente: aquí la Y
                // ya está recalculada tras colapsar/expandir.
                registrarLayoutSeccion(seccion.id, e.nativeEvent.layout.y);
              }}
              className="mb-3 bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100"
            >
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  const nuevaAbierta = estaAbierta ? null : seccion.id;
                  setSeccionExpandidaId(nuevaAbierta);
                  if (nuevaAbierta) desplazarASeccion(nuevaAbierta);
                }}
                className={`flex-row items-center justify-between p-5 ${estaAbierta ? 'bg-blue-50/40' : 'bg-white'}`}
              >
                <View className="flex-row items-center flex-1 pr-4">
                  <View className={`w-3 h-3 rounded-full mr-3 ${getSeccionStatusColor(seccion.id)}`} />
                  <View className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${estaAbierta ? 'bg-[#1E3A8A]' : 'bg-gray-100'}`}>
                    <Text className={`font-black text-xs ${estaAbierta ? 'text-white' : 'text-gray-500'}`}>{seccion.orden || '#'}</Text>
                  </View>
                  <Text className={`font-bold text-base flex-1 ${estaAbierta ? 'text-[#1E3A8A]' : 'text-gray-700'}`}>{seccion.nombre || 'Sección'}</Text>
                </View>
                <Feather name={estaAbierta ? "chevron-up" : "chevron-down"} size={20} color={estaAbierta ? "#1E3A8A" : "#9CA3AF"} />
              </TouchableOpacity>

              {estaAbierta && (
                <View className="p-5 border-t border-gray-50 gap-y-5 bg-white">
                  {preguntasRaiz.map((p) => {
                    if (!isQuestionVisible(p)) return null;

                    if (p.tipo_dato?.toUpperCase() === 'MATRIZ') {
                      //const preguntasHijas = preguntas.filter(hija => hija.id_matriz_padre === p.id);
                      const preguntasHijas = preguntas.filter(hija => String(hija.id_matriz_padre) === String(p.id));
                      const filas = instanciasMatriz[p.id] || [];

                      return (
                        <View key={p.id} className="mb-2 bg-blue-50/60 p-4 rounded-[32px] border border-blue-100">
                          <View className="flex-row justify-between items-center mb-4 px-2">
                            <Text className="font-bold text-[#1E3A8A] flex-1 mr-2">{p.etiqueta}</Text>
                            <TouchableOpacity onPress={() => añadirFilaMatriz(p.id)} className="bg-[#1E3A8A] px-4 py-2 rounded-full flex-row items-center shadow-sm">
                              <Feather name="plus" size={16} color="white" />
                              <Text className="text-white font-bold ml-1 text-xs">Añadir</Text>
                            </TouchableOpacity>
                          </View>

                          {filas.map((uuidFila, index) => (
                            <View key={uuidFila} className="bg-white p-5 rounded-[24px] mb-4 shadow-sm border border-gray-200">
                              <View className="flex-row justify-between items-center mb-4 border-b border-gray-100 pb-3">
                                <Text className="text-gray-400 font-black text-[10px] tracking-widest uppercase">REFERENCIA #{index + 1}</Text>
                                <TouchableOpacity onPress={() => eliminarFilaMatriz(p.id, uuidFila)} className="bg-red-50 p-2 rounded-full">
                                  <Feather name="trash-2" size={16} color="#EF4444" />
                                </TouchableOpacity>
                              </View>

                              {preguntasHijas.map(hija => {
                                if (!isQuestionVisible(hija, uuidFila)) return null;
                                return (
                                  <View key={hija.id} className="mb-4">
                                    <SurveyField
                                      tipoDato={hija.tipo_dato}
                                      etiqueta={hija.etiqueta}
                                      esObligatorio={hija.es_obligatorio === 1}
                                      esEditable={hija.es_editable === 1}
                                      valor={respuestas[`${hija.id}_${uuidFila}`] || ''}
                                      opciones={obtenerOpciones(hija, uuidFila)}
                                      arbolOpciones={obtenerArbolOpciones(hija, uuidFila)}
                                      reglaValidacion={hija.regla_validacion}
                                      onChangeText={(txt) => handleRespuestaChange(`${hija.id}_${uuidFila}`, txt)}
                                      onBlur={() => { }}
                                      // Los archivos de una fila de matriz se identifican
                                      // por (instancia, pregunta, uuidFila): eliminar la
                                      // fila debe poder llevarse su adjunto.
                                      contextoCaptura={{
                                        idEncuesta: idEncuestaSeguro,
                                        idPregunta: String(hija.id),
                                        uuidBase: instanciaEncuestaUuid,
                                        uuidFila,
                                      }}
                                    />
                                  </View>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      );
                    }

                    return (
                      <View key={p.id} className="mb-2">
                        <SurveyField
                          tipoDato={p.tipo_dato}
                          etiqueta={p.etiqueta}
                          esObligatorio={p.es_obligatorio === 1}
                          esEditable={p.es_editable === 1}
                          valor={respuestas[p.id] || ''}
                          opciones={obtenerOpciones(p)}
                          arbolOpciones={obtenerArbolOpciones(p)}
                          reglaValidacion={p.regla_validacion}
                          onChangeText={(txt) => handleRespuestaChange(p.id, txt)}
                          onBlur={() => { }}
                          mensajeInfo={esTipoCalculo(p.tipo_dato) ? "Calculado automáticamente" : undefined}
                          contextoCaptura={{
                            idEncuesta: idEncuestaSeguro,
                            idPregunta: String(p.id),
                            uuidBase: instanciaEncuestaUuid,
                            uuidFila: null,
                          }}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          className={`p-5 rounded-[22px] flex-row justify-center items-center mt-6 mb-16 shadow-lg ${isSaving ? 'bg-gray-400' : 'bg-[#1E3A8A]'}`}
          onPress={handleFinalizarFormulario}
          disabled={isSaving}
        >
          {isSaving ? <ActivityIndicator color="white" /> : (
            <>
              <Feather name="check-circle" size={24} color="white" />
              <Text className="text-white font-bold text-lg ml-3">Finalizar Gestión</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showPauseModal} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
            <View className="bg-amber-100 p-4 rounded-full mb-4">
              <Feather name="pause-circle" size={48} color="#F59E0B" />
            </View>
            <Text className="text-xl font-bold text-gray-800 text-center">¿Pausar encuesta?</Text>
            <Text className="text-gray-500 text-center mt-3 leading-5">Los datos ingresados se guardarán localmente para continuar después.</Text>
            <View className="flex-row mt-10 gap-3">
              <TouchableOpacity className="flex-1 py-4 bg-gray-50 rounded-2xl border border-gray-200" onPress={() => setShowPauseModal(false)}>
                <Text className="text-center text-gray-600 font-bold">Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 bg-[#1E3A8A] py-4 rounded-2xl shadow-md" onPress={handlePausarFormulario}>
                <Text className="text-center text-white font-bold">Sí, pausar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const enhance = withObservables(['route'], ({ route }: any) => {
  const idEncuesta = route?.params?.idEncuesta || null;
  const uuidInstanciaBase = route?.params?.uuidInstanciaBase || '';

  return {
    encuesta: idEncuesta ? database.collections.get<LocalEncuesta>('local_encuesta').findAndObserve(idEncuesta) : null,
    secciones: database.collections.get<LocalSeccion>('local_seccion').query(Q.where('id_encuesta', idEncuesta !== null ? idEncuesta : '')),
    preguntas: database.collections.get<LocalEstructuraPregunta>('local_estructura_pregunta').query(Q.where('id_encuesta', idEncuesta !== null ? idEncuesta : '')),
    catalogos: database.collections.get<CatalogoOpcion>('local_catalogo_opciones').query(),
    capturasExistentes: database.collections.get<LocalCaptura>('local_captura').query(
      Q.where('id_encuesta', idEncuesta !== null ? idEncuesta : ''),
      Q.where('uuid_instancia', Q.like(`${uuidInstanciaBase}%`)),
      Q.where('estado_sincro', -1)
    ),
  };
});

export const DynamicSurveyScreen = enhance(DynamicSurvey as any);