import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator, BackHandler, Keyboard, findNodeHandle } from 'react-native';
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

/** Nodo del árbol de opciones con drill-down jerárquico (SELECT anidado). */
interface NodoOpcionArbol {
  valor: string;
  hijos: NodoOpcionArbol[];
}

/**
 * Convierte un valor capturado a número tolerando el separador decimal en coma
 * (teclado en español, ej. "12,5") además del punto ("12.5"), y separadores de
 */
const parseNumeroLocal = (valorCrudo: string): number => {
  let limpio = String(valorCrudo || '').trim().replace(/[^0-9.,-]/g, '');
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');

  if (ultimaComa > ultimoPunto) {
    // La coma es el separador decimal; cualquier punto previo es de miles.
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    // El punto es el separador decimal (o no hay separadores); las comas son de miles.
    limpio = limpio.replace(/,/g, '');
  }
  return parseFloat(limpio);
};

/**
 * Nombre de catálogo bajo el que se buscan las opciones de una pregunta en
 * local_catalogo_opciones. Para origen_datos_tipo='API' es el nombre sintético
 * "API_<idPregunta>" que genera syncManager.sincronizarCatalogosApi() — en ese
 * caso origen_datos_cmd es la URL externa (ej. municipios por departamento),
 * NO un nombre de catálogo, así que no se puede usar directamente para buscar.
 */
const resolverNombreCatalogo = (p: LocalEstructuraPregunta): string => {
  const raw = leerRaw<RawPregunta>(p);
  const tipo = (p.origen_datos_tipo || raw.origen_datos_tipo || '').trim().toUpperCase();
  if (tipo === 'API') return `API_${p.id}`;
  return String(p.opciones || raw.opciones || raw.origen_datos_cmd || '');
};

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

  const scrollViewRef = useRef<ScrollView>(null);
  const sectionRefs = useRef<Record<string, View | null>>({});
  const puedeSalir = useRef(false);

  // Se sustituye el useState por un useRef para almacenar las coordenadas "Y" de forma silenciosa
  const seccionLayoutsRef = useRef<Record<string, number>>({});

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
   * Traduce una referencia de regla a un id de pregunta real. El BackOffice escribe
   * el token "Qn" (ej. `Q53=="SI"`); n se resuelve primero contra el `id` de la
   * pregunta y, si no existe, contra su `orden` (prefiriendo la misma sección).
   * Si la referencia no es un token Qn se devuelve tal cual (id crudo).
   */
  const resolverIdDesdeToken = (referencia: string, preguntaActual: LocalEstructuraPregunta): string => {
    const tokenQ = String(referencia).match(/^Q(\d+)$/i);
    if (!tokenQ) return String(referencia);
    const numero = tokenQ[1];
    const raw = (x: LocalEstructuraPregunta) => leerRaw<RawPregunta>(x);

    let origen = preguntas.find(x => String(x.id) === numero);
    if (!origen) {
      const candidatos = preguntas.filter(x => String(raw(x).orden) === numero);
      const seccionActual = String(raw(preguntaActual).id_seccion);
      origen = candidatos.find(x => String(raw(x).id_seccion) === seccionActual) || candidatos[0];
    }
    return origen ? String(origen.id) : String(referencia);
  };

  const isQuestionVisible = (p: LocalEstructuraPregunta, uuidFila?: string | null, snap: Record<string, string> = respuestas) => {
    if (!p.regla_visibilidad) return true;

    // Resuelve la respuesta de una pregunta dependiente. Dentro de una fila de matriz
    // las respuestas se almacenan con la clave "idPregunta_uuidFila"; por eso se
    // prioriza esa variante antes de caer a la clave global.
    const resolverRespuesta = (idPreg: string): string => {
      if (uuidFila) {
        const scoped = snap[`${idPreg}_${uuidFila}`];
        if (scoped !== undefined) return scoped;
      }
      return snap[idPreg] ?? '';
    };

    // Comparación tolerante a mayúsculas/acentos ("Sí" === "SI" === "si")
    const normalizarComparacion = (v: unknown) =>
      String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

    try {
      const reglaStr = p.regla_visibilidad.toString().trim();
      if (reglaStr.startsWith('{')) {
        const regla = JSON.parse(reglaStr);
        // Cascada de catálogos (Padre-Hijo-Nieto): solo es visible si su pregunta
        // padre inmediata ya tiene una respuesta seleccionada.
        if (regla.dependeDeCatalogo) {
          const respuestaPadre = resolverRespuesta(regla.dependeDeCatalogo);
          return !!respuestaPadre && respuestaPadre.toString().trim() !== '';
        }
        return normalizarComparacion(resolverRespuesta(regla.dependeDe)) === normalizarComparacion(regla.valorEsperado);
      }
      // Comparación simple: admite tanto un id crudo (`53=="SI"`) como el token del
      // BackOffice (`Q53=="SI"`), que se traduce al id real de la pregunta.
      const matches = reglaStr.match(/(\w+)\s*(==|===|=)\s*['"]([^'"]+)['"]/);
      if (matches) {
        const [_, referencia, __, valorEsperado] = matches;
        const idReal = resolverIdDesdeToken(referencia, p);
        return normalizarComparacion(resolverRespuesta(idReal)) === normalizarComparacion(valorEsperado);
      }
      // Evaluación genérica (reglas compuestas): primero se sustituyen los tokens Qn
      // por el valor de la pregunta referenciada, luego las claves crudas.
      let reglaEvaluada = reglaStr.replace(/\bQ(\d+)\b/gi, (_m, num) => {
        const valorToken = resolverRespuesta(resolverIdDesdeToken(`Q${num}`, p));
        return `'${String(valorToken).replace(/'/g, "\\'")}'`;
      });
      const fuente: Record<string, string> = { ...snap };
      if (uuidFila) {
        const sufijo = `_${uuidFila}`;
        Object.keys(snap).forEach(k => {
          if (k.endsWith(sufijo)) fuente[k.slice(0, -sufijo.length)] = snap[k];
        });
      }
      Object.keys(fuente).forEach(key => {
        const val = fuente[key] ? `'${fuente[key]}'` : "''";
        // Límites de palabra para no corromper números ya sustituidos.
        reglaEvaluada = reglaEvaluada.replace(new RegExp(`\\b${key}\\b`, 'g'), val);
      });
      return Function(`"use strict"; return (${reglaEvaluada})`)();
    } catch (e) {
      // Una regla mal formada haría que la pregunta quede siempre visible sin aviso,
      // indistinguible de "sin regla". Se advierte para poder corregirla en el BackOffice.
      console.warn(`[VISIBILIDAD] Regla inválida en "${p.etiqueta}":`, p.regla_visibilidad, e);
      return true;
    }
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

  // Detección tolerante del tipo (el resto del código normaliza igual; ver SurveyField)
  const esTipoCalculo = (t?: string | null) => (t || '').trim().toUpperCase() === 'CALCULO';

  /**
   * Motor genérico de cálculo. Recibe un mapa de respuestas y devuelve una copia con
   * todos los campos tipo CALCULO resueltos. 
   */
  const aplicarCalculos = (
    base: Record<string, string>,
    matrices: Record<string, string[]> = instanciasMatriz
  ): Record<string, string> => {
    const nuevasRespuestas = { ...base };
    let huboCambios = true;
    let iteraciones = 0;

    const esLadoOperativo = (s: string) => /[+\-*/^%]/.test(s) || /[a-zA-Z_]\w*\s*\(/.test(s);

    while (huboCambios && iteraciones < 5) {
      huboCambios = false;
      iteraciones++;
      preguntas
        .filter(p => esTipoCalculo(p.tipo_dato) && (leerRaw<RawPregunta>(p).sintaxis_calculo || p.sintaxis_calculo))
        .forEach(p => {
          try {
            const rawP = leerRaw<RawPregunta>(p);

            // El diseño documenta placeholders con corchetes ([Q92]-[Q91] o [92]-[91]);
            // se normalizan a tokens Qn ANTES de evaluar — de lo contrario mathjs
            // interpretaría los corchetes como matrices y el resultado sería NaN.
            const rawFormula = String(rawP.sintaxis_calculo || "").replace(/\[\s*Q?(\d+)\s*\]/gi, 'Q$1');
            const partes = rawFormula.split('=');
            let expr = partes[0];
            if (partes.length > 1) {
              expr = partes.find(esLadoOperativo)
                || partes.reduce((a, b) => ((b.match(/Q\d+/gi) || []).length > (a.match(/Q\d+/gi) || []).length ? b : a));
            }
            const exprBase = expr.trim();

            // Tokens únicos (Q + dígitos, insensible a mayúsculas).
            const tokens = [...new Set((exprBase.match(/\bQ\d+\b/gi) || []).map(t => t.toUpperCase()))];
            if (tokens.length === 0) return;

            // Un CALCULO hijo de matriz se evalúa una vez POR FILA; uno de nivel raíz,
            // una sola vez con contexto global (uuidFila = null).
            const idMatrizPadre = rawP.id_matriz_padre;
            const esHijaDeMatriz = !!idMatrizPadre &&
              String(idMatrizPadre).toLowerCase() !== 'null' && String(idMatrizPadre) !== '';
            const contextos: (string | null)[] = esHijaDeMatriz
              ? (matrices[String(idMatrizPadre)] || [])
              : [null];

            contextos.forEach(uuidFila => {
              let formulaStr = exprBase;
              let puedeCalcular = true;

              tokens.forEach(token => {
                const idReal = resolverIdDesdeToken(token, p);
                const preguntaOrigen = preguntas.find(x => String(x.id) === idReal);

                if (preguntaOrigen) {
                  // Dentro de una fila se prioriza el valor de ESA fila; si el token
                  // referencia un campo fuera de la matriz, cae a la clave global.
                  const claveScoped = uuidFila ? `${preguntaOrigen.id}_${uuidFila}` : null;
                  const valorCrudo = (claveScoped && nuevasRespuestas[claveScoped] !== undefined)
                    ? nuevasRespuestas[claveScoped]
                    : (nuevasRespuestas[preguntaOrigen.id] || "");
                  const parseado = parseNumeroLocal(valorCrudo);

                  if (isNaN(parseado)) {
                    puedeCalcular = false;
                  } else {
                    formulaStr = formulaStr.replace(new RegExp(`\\b${token}\\b`, 'gi'), String(parseado));
                  }
                } else {
                  puedeCalcular = false;
                  console.warn(`[CALCULO] token ${token} no resuelve a ninguna pregunta (ni por id ni por orden) en campo "${p.etiqueta}"`);
                }
              });

              const claveDestino = uuidFila ? `${p.id}_${uuidFila}` : p.id;

              if (puedeCalcular) {
                const ejecutor = evaluate(formulaStr);
                const stringFinal = parseFloat(Number(ejecutor).toFixed(2)).toString();

                if (nuevasRespuestas[claveDestino] !== stringFinal) {
                  nuevasRespuestas[claveDestino] = stringFinal;
                  huboCambios = true;
                }
              } else if (nuevasRespuestas[claveDestino] !== undefined && nuevasRespuestas[claveDestino] !== '') {
                nuevasRespuestas[claveDestino] = '';
                huboCambios = true;
              }
            });
          } catch (e) {
            console.warn("[CALCULO] Error evaluando fórmula:", e);
          }
        });
    }
    return nuevasRespuestas;
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
    const calculadas = aplicarCalculos({ ...respuestas, [idPregunta]: valor });
    const { respuestas: purgadas, matrices, keysEliminadas } = purgarOcultos(calculadas, instanciasMatriz);
    setRespuestas(purgadas);
    setInstanciasMatriz(matrices);
    if (keysEliminadas.length > 0) purgarCapturasPersistidas(keysEliminadas);
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

      let nombreDetectado = 'NUEVA ENCUESTA';
      const preguntaNombre = preguntas.find(p =>
        p.etiqueta?.toLowerCase().includes('nombre completo') ||
        p.etiqueta?.toLowerCase().includes('nombre')
      );
      if (preguntaNombre && mapa[preguntaNombre.id]) {
        nombreDetectado = mapa[preguntaNombre.id].trim();
      }

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

  const obtenerOpciones = (p: LocalEstructuraPregunta, uuidFila?: string | null): string => {
    if (!p) return JSON.stringify([]);

    const rawPregunta = leerRaw<RawPregunta>(p);
    const tipoOrigenDatos = (p.origen_datos_tipo || rawPregunta.origen_datos_tipo || '').trim().toUpperCase();
    const esOrigenApi = tipoOrigenDatos === 'API';
    const opcionesString = p.opciones || rawPregunta.opciones || rawPregunta.origen_datos_cmd || '';

    if (!opcionesString && !esOrigenApi) return JSON.stringify([]);

    const rawString = String(opcionesString || '').trim();
    // 1. CASO A: El backend envió un arreglo JSON directo (Ej: '["Masculino", "Femenino"]')
    if (rawString.startsWith('[')) {
      return rawString;
    }

    // 2. CASO B: Opciones enviadas como texto separado por Pipes (|) o Comas (,) que NO son
    // catálogos. No aplica a origen 'API': ahí el string es una URL, no una lista inline.
    if (!esOrigenApi && !rawString.toUpperCase().includes('CAT_')) {
      if (rawString.includes('|')) {
        return JSON.stringify(rawString.split('|').map(o => o.trim()));
      }
      if (rawString.includes(',')) {
        return JSON.stringify(rawString.split(',').map(o => o.trim()));
      }
    }
    // 3. CASO C: Búsqueda en Catálogos SQLite con NORMALIZACIÓN EXTREMA
    // Esta sub-función elimina tildes, acentos, espacios extra y estandariza mayúsculas/minúsculas
    const normalizar = (str: string) =>
      String(str)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quita todas las tildes (é -> e)
        .trim().toLowerCase().replace('cat_', '');

    // Para origen 'API' se busca por el nombre sintético "API_<idPregunta>" — el
    // OrigenDatosCmd original (la URL) no sirve como nombre de catálogo.
    const strBuscar = normalizar(esOrigenApi ? resolverNombreCatalogo(p) : rawString);

    let idOpcionPadreRequerido: string | null = null;
    if (p.regla_visibilidad && p.regla_visibilidad.includes('dependeDeCatalogo')) {
      try {
        const reglaCascada = JSON.parse(p.regla_visibilidad);
        const idPadreCascada = reglaCascada.dependeDeCatalogo;
        // La respuesta del padre puede estar acotada a la fila de matriz actual.
        const respuestaPadreTxt = (uuidFila ? respuestas[`${idPadreCascada}_${uuidFila}`] : undefined) ?? respuestas[idPadreCascada];

        if (respuestaPadreTxt) {
          const preguntaPadre = preguntas.find(x => x.id === idPadreCascada);
          const catalogoPadreNormalizado = normalizar(preguntaPadre ? resolverNombreCatalogo(preguntaPadre) : '');

          const candidatosPadre = catalogos.filter(c => String(leerRaw<RawCatalogoOpcion>(c).valor_opcion) === respuestaPadreTxt);
        
          const candidatosDelCatalogoPadre = catalogoPadreNormalizado
            ? candidatosPadre.filter(c => {
                const rCat = leerRaw<RawCatalogoOpcion>(c);
                const nombreCatBD = normalizar(rCat.nombre_catalogo || '');
                const codigoCatBD = normalizar(rCat.codigo_catalogo || '');
                return nombreCatBD.includes(catalogoPadreNormalizado) ||
                  codigoCatBD.includes(catalogoPadreNormalizado) ||
                  catalogoPadreNormalizado.includes(nombreCatBD);
              })
            : [];

          const catPadre = candidatosDelCatalogoPadre[0] || candidatosPadre[0];

          if (catPadre) idOpcionPadreRequerido = String(leerRaw<RawCatalogoOpcion>(catPadre).id_remoto || leerRaw<RawCatalogoOpcion>(catPadre).codigo_opcion);
        } else {
          return ''; // Si no ha respondido al padre, el hijo se muestra vacío
        }
      } catch (e) { console.warn("Error evaluando cascada"); }
    }

    const items = catalogos
      .filter(c => {
        const rawCat = leerRaw<RawCatalogoOpcion>(c);

        const nombreCatBD = normalizar(rawCat.nombre_catalogo || '');
        const codigoCatBD = normalizar(rawCat.codigo_catalogo || '');

        // Búsqueda flexible (includes) para evitar fallos por espacios o guiones
        const perteneceCatalogo = nombreCatBD === strBuscar ||
          codigoCatBD === strBuscar ||
          nombreCatBD.includes(strBuscar) ||
          codigoCatBD.includes(strBuscar);

        if (idOpcionPadreRequerido) {
          return perteneceCatalogo && String(rawCat.id_padre_opcion) === idOpcionPadreRequerido;
        }

        return perteneceCatalogo;
      })
      .map(c => String(leerRaw<RawCatalogoOpcion>(c).valor_opcion));

    if (items.length === 0 && !esOrigenApi && !rawString.toUpperCase().includes('CAT_')) {
      return JSON.stringify([rawString]);
    }

    return items.length > 0 ? JSON.stringify(items) : '';
  };

   // navegación drill-down (Padre→Hijo→Nieto) dentro del mismo input. Devuelve un JSON
  
  const obtenerArbolOpciones = (p: LocalEstructuraPregunta, uuidFila?: string | null): string => {
    if (!p) return JSON.stringify([]);

    const rawPregunta = leerRaw<RawPregunta>(p);
    const tipoOrigenDatos = (p.origen_datos_tipo || rawPregunta.origen_datos_tipo || '').trim().toUpperCase();
    const esOrigenApi = tipoOrigenDatos === 'API';
    const opcionesString = p.opciones || rawPregunta.opciones || rawPregunta.origen_datos_cmd || '';
    const rawString = String(opcionesString || '').trim();
    // ya vienen filtradas a un solo padre → planas.
    const esCascadaHija = !!(p.regla_visibilidad && p.regla_visibilidad.includes('dependeDeCatalogo'));
    const upper = rawString.toUpperCase();
    // Origen 'API': el string es una URL, nunca una lista inline aunque contenga ',' o '|'.
    const esInline = !esOrigenApi && (rawString.startsWith('[') ||
      (!upper.includes('CAT_') && (rawString.includes('|') || rawString.includes(','))));

    if (!rawString || esInline || esCascadaHija) {
      // Árbol plano reutilizando la resolución existente.
      let planas: string[] = [];
      try { planas = JSON.parse(obtenerOpciones(p, uuidFila) || '[]'); } catch { planas = []; }
      return JSON.stringify(planas.map(v => ({ valor: v, hijos: [] })));
    }

    const normalizar = (str: string) =>
      String(str)
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .trim().toLowerCase().replace('cat_', '');

    // Origen 'API': se busca por el nombre sintético "API_<idPregunta>" (ver obtenerOpciones).
    const strBuscar = normalizar(esOrigenApi ? resolverNombreCatalogo(p) : rawString);

    // Opciones que pertenecen al catálogo de esta pregunta (mismo predicado que obtenerOpciones).
    const delCatalogo = catalogos.filter(c => {
      const rc = leerRaw<RawCatalogoOpcion>(c);
      const nombreCatBD = normalizar(rc.nombre_catalogo || '');
      const codigoCatBD = normalizar(rc.codigo_catalogo || '');
      return nombreCatBD === strBuscar || codigoCatBD === strBuscar ||
        nombreCatBD.includes(strBuscar) || codigoCatBD.includes(strBuscar);
    });

    if (delCatalogo.length === 0) return JSON.stringify([]);

    const idsDelCatalogo = new Set(delCatalogo.map(c => String(leerRaw<RawCatalogoOpcion>(c).id_remoto)));

    const construirNodo = (reg: RawCatalogoOpcion, visitados: Set<string>, prof: number): NodoOpcionArbol => {
      const idRemoto = String(reg.id_remoto);
      let hijos: NodoOpcionArbol[] = [];
      if (prof < 5 && !visitados.has(idRemoto)) {
        visitados.add(idRemoto);
        hijos = catalogos
          .filter(c => String(leerRaw<RawCatalogoOpcion>(c).id_padre_opcion) === idRemoto)
          .map(c => construirNodo(leerRaw<RawCatalogoOpcion>(c), visitados, prof + 1));
      }
      return { valor: String(reg.valor_opcion), hijos };
    };

    // Raíces: opciones del catálogo sin padre dentro del propio catálogo.
    const roots = delCatalogo.filter(c => {
      const idPadre = leerRaw<RawCatalogoOpcion>(c).id_padre_opcion;
      const idPadreStr = String(idPadre ?? '').trim();
      return !idPadre || idPadreStr === '' || idPadreStr.toLowerCase() === 'null' || !idsDelCatalogo.has(idPadreStr);
    });

    const arbol = roots.map(c => construirNodo(leerRaw<RawCatalogoOpcion>(c), new Set<string>(), 0));
    return JSON.stringify(arbol);
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
                //Se escribe en la referencia en lugar del estado para no disparar ciclos prematuros
                seccionLayoutsRef.current[seccion.id] = e.nativeEvent.layout.y;
              }}
              className="mb-3 bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100"
            >
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  const nuevaAbierta = estaAbierta ? null : seccion.id;
                  setSeccionExpandidaId(nuevaAbierta);
                  if (nuevaAbierta) {
                    setTimeout(() => {
                      // Desplazamiento basado en la referencia estable en memoria
                      const posicionY = seccionLayoutsRef.current[nuevaAbierta];
                      if (posicionY !== undefined) {
                        scrollViewRef.current?.scrollTo({ y: posicionY - 10, animated: true });
                      }
                    }, 280);
                  }
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