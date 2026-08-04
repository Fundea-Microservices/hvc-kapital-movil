import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import {
  ESTADO_SUBIDA,
  registrarArchivoLocal,
  eliminarArchivoLocal,
  obtenerArchivoLocal,
  resolverUri,
  type ArchivoSeleccionado,
  type ContextoCaptura,
} from '../../../data/local/services/multimedia.service';
import { obtenerParametroNumerico } from '../../../data/local/services/parametros.service';
import {
  formatearTamanio,
  parsearTokenMedia,
  type TipoMedio,
} from '../../../domain/multimedia/token';

interface CampoMultimediaProps {
  /** Familia de captura ya resuelta desde los alias del BackOffice. */
  tipo: TipoMedio;
  /** Token guardado en la respuesta, o cadena vacía si aún no hay archivo. */
  valor: string;
  esEditable: boolean;
  /** Identifica la respuesta a la que pertenece el archivo. */
  contexto: ContextoCaptura;
  /** Recibe el token a persistir, o cadena vacía al eliminar. */
  onChangeText: (texto: string) => void;
  onBlur: () => void;
}

/** Configuración visual por familia. Feather usa una unión cerrada de nombres. */
const PRESENTACION: Record<TipoMedio, { icono: 'camera' | 'image' | 'file-text' | 'edit-3'; etiqueta: string; accion: string }> = {
  FOTO: { icono: 'camera', etiqueta: 'Fotografía', accion: 'Tomar foto' },
  MULTIMEDIA: { icono: 'image', etiqueta: 'Imagen o video', accion: 'Elegir de la galería' },
  DOCUMENTO: { icono: 'file-text', etiqueta: 'Documento', accion: 'Seleccionar archivo' },
  FIRMA: { icono: 'edit-3', etiqueta: 'Firma', accion: 'Firmar' },
};

/** Extensiones ofimáticas que acepta el selector de documentos. */
const MIME_DOCUMENTOS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
];

/**
 * Captura de archivos adjuntos: foto de cámara, medio de galería o documento.
 *
 * POR QUÉ ES UN COMPONENTE APARTE Y NO CÓDIGO DENTRO DEL `switch`
 * Las tres ramas comparten estado propio (carga, miniatura, permisos) y efectos de
 * montaje. Meterlos en `SurveyField` obligaría a declarar esos hooks para todas las
 * preguntas del formulario —también las de texto— y a mantener sincronizado un estado
 * que solo tiene sentido en cuatro de los veinte tipos. El `switch` conserva sus tres
 * `case`, que es donde se lee el polimorfismo, y delega el cómo aquí.
 *
 * EL ARCHIVO NO VIAJA EN LA RESPUESTA
 * `onChangeText` recibe un TOKEN (`MEDIA::FOTO::recibo.jpg::248310`), no la URI. El
 * binario vive en `local_multimedia`, tabla propia, porque el auto-save destruye y
 * recrea las filas de `local_captura` cada ~1,5 segundos.
 */
export const CampoMultimedia = ({
  tipo,
  valor,
  esEditable,
  contexto,
  onChangeText,
  onBlur,
}: CampoMultimediaProps) => {
  const [cargando, setCargando] = useState(false);
  const [uriLocal, setUriLocal] = useState<string | null>(null);
  const [estadoSubida, setEstadoSubida] = useState<number>(ESTADO_SUBIDA.PENDIENTE);

  const presentacion = PRESENTACION[tipo];
  const token = parsearTokenMedia(valor);
  const esImagen = tipo === 'FOTO' || tipo === 'MULTIMEDIA' || tipo === 'FIRMA';

  /**
   * Recupera la URI absoluta al montar y cada vez que cambia el token.
   *
   * Se resuelve aquí y no se guarda en la respuesta porque en iOS el contenedor de la
   * aplicación lleva un UUID que cambia al actualizarla: una URI absoluta persistida
   * dejaría de existir tras la primera actualización y la miniatura saldría rota.
   */
  useEffect(() => {
    let vigente = true;

    const cargar = async () => {
      if (!token) {
        if (vigente) setUriLocal(null);
        return;
      }
      try {
        const fila = await obtenerArchivoLocal(
          contexto.uuidBase,
          contexto.idPregunta,
          contexto.uuidFila,
        );
        if (!vigente) return;
        setUriLocal(fila ? resolverUri(fila.ruta_relativa) : null);
        setEstadoSubida(fila?.estado_subida ?? ESTADO_SUBIDA.PENDIENTE);
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        console.error(`❌ [Multimedia] No se pudo resolver el archivo: ${detalle}`);
        if (vigente) setUriLocal(null);
      }
    };

    void cargar();
    return () => { vigente = false; };
  }, [valor, contexto.uuidBase, contexto.idPregunta, contexto.uuidFila]);

  /*
   * DEUDA CONOCIDA — muerte del proceso durante la cámara (Android gama baja).
   *
   * La cámara consume mucha memoria y el sistema puede matar la aplicación de fondo.
   * Al volver, `launchCameraAsync` ya terminó pero su promesa murió con el proceso: la
   * foto se pierde en silencio y el asesor jura haberla tomado.
   *
   * `ImagePicker.getPendingResultAsync()` devuelve ese resultado huérfano, PERO no
   * indica qué pregunta lo pidió. Recuperarlo aquí, en un componente por campo,
   * asignaría la foto al primer campo que se monte, que casi nunca es el correcto.
   * La solución correcta es guardar la coordenada pedida antes de abrir la cámara y
   * recuperarla en el arranque de la pantalla, no en este componente. Se deja sin
   * implementar y anotado, en vez de con una versión que parezca cubrirlo.
   */

  /** Peso máximo vigente, configurable desde el BackOffice sin publicar versión. */
  const pesoMaximoKb = async (): Promise<number> =>
    obtenerParametroNumerico('MULTIMEDIA_PESO_MAXIMO_KB', 5120);

  /**
   * Punto único donde el archivo elegido se copia a almacenamiento durable y se
   * convierte en token. Las tres fuentes (cámara, galería, documentos) terminan aquí.
   */
  const procesarSeleccion = async (seleccionado: ArchivoSeleccionado): Promise<void> => {
    const maximoKb = await pesoMaximoKb();
    const bytes = seleccionado.tamanio ?? 0;

    // Se valida ANTES de copiar: rechazar después habría duplicado en disco un archivo
    // que de todos modos el servidor no va a aceptar.
    if (bytes > 0 && bytes > maximoKb * 1024) {
      Alert.alert(
        'Archivo demasiado grande',
        `El archivo pesa ${formatearTamanio(bytes)} y el máximo permitido es ${maximoKb} KB. ` +
        'Intente con una foto de menor calidad o un archivo más liviano.',
      );
      return;
    }

    const registrado = await registrarArchivoLocal(contexto, tipo, seleccionado);
    setUriLocal(registrado.uri);
    setEstadoSubida(ESTADO_SUBIDA.PENDIENTE);
    onChangeText(registrado.token);
    onBlur();
  };

  /**
   * FOTO / CÁMARA: abre EXCLUSIVAMENTE la cámara.
   *
   * `launchCameraAsync` no ofrece acceso a la galería, que es justamente el requisito:
   * la evidencia debe tomarse en el momento y en el lugar, no adjuntarse desde una
   * imagen guardada. La propia interfaz nativa resuelve el "repetir / aceptar".
   */
  const abrirCamara = async (): Promise<void> => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert(
        'Permiso de cámara requerido',
        permiso.canAskAgain
          ? 'Debe autorizar el uso de la cámara para adjuntar la fotografía.'
          : 'El permiso fue denegado permanentemente. Actívelo desde los ajustes del sistema.',
      );
      return;
    }

    // La calidad es parametrizable: bajarla reduce mucho el consumo de datos en campo,
    // donde la subida ocurre por red móvil rural.
    const calidad = await obtenerParametroNumerico('MULTIMEDIA_CALIDAD_FOTO', 0.7);

    const resultado = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: calidad > 0 && calidad <= 1 ? calidad : 0.7,
      allowsEditing: false,
      exif: false,
    });

    if (resultado.canceled) return;
    const activo = resultado.assets?.[0];
    if (!activo) return;

    await procesarSeleccion({
      uri: activo.uri,
      nombre: activo.fileName,
      mimeType: activo.mimeType,
      tamanio: activo.fileSize ?? null,
    });
  };

  /** MULTIMEDIA: galería con imágenes y videos. */
  const abrirGaleria = async (): Promise<void> => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert(
        'Permiso de galería requerido',
        'Debe autorizar el acceso a sus archivos para adjuntar una imagen o video.',
      );
      return;
    }

    // El video se puede desactivar desde el BackOffice: en operaciones con datos
    // limitados, un video de 40 MB bloquea la sincronización del asesor.
    const permiteVideo = (await obtenerParametroNumerico('MULTIMEDIA_PERMITE_VIDEO', 1)) === 1;

    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: permiteVideo ? ['images', 'videos'] : ['images'],
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });

    if (resultado.canceled) return;
    const activo = resultado.assets?.[0];
    if (!activo) return;

    await procesarSeleccion({
      uri: activo.uri,
      nombre: activo.fileName,
      mimeType: activo.mimeType,
      tamanio: activo.fileSize ?? null,
    });
  };

  /** FILE / DOCUMENTO: selector de documentos ofimáticos. */
  const abrirDocumentos = async (): Promise<void> => {
    const resultado = await DocumentPicker.getDocumentAsync({
      type: MIME_DOCUMENTOS,
      // La copia a caché la hace el propio selector; el servicio la mueve enseguida a
      // almacenamiento durable, porque la caché la purga el sistema operativo.
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (resultado.canceled) return;
    const activo = resultado.assets?.[0];
    if (!activo) return;

    await procesarSeleccion({
      uri: activo.uri,
      nombre: activo.name,
      mimeType: activo.mimeType,
      tamanio: activo.size ?? null,
    });
  };

  /** Despacha según la familia. Un solo punto de manejo de errores y de `isLoading`. */
  const capturar = async (): Promise<void> => {
    if (!esEditable || cargando) return;

    setCargando(true);
    try {
      if (tipo === 'FOTO') await abrirCamara();
      else if (tipo === 'MULTIMEDIA') await abrirGaleria();
      else if (tipo === 'DOCUMENTO') await abrirDocumentos();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.error(`❌ [Multimedia] Captura fallida (${tipo}): ${detalle}`);
      Alert.alert(
        'No se pudo adjuntar el archivo',
        'Ocurrió un problema al procesar el archivo. Intente nuevamente.',
      );
    } finally {
      // En `finally` para que un error a mitad no deje el botón girando para siempre.
      setCargando(false);
    }
  };

  /** Elimina el adjunto: borra el binario, la fila de la cola y el token. */
  const eliminar = (): void => {
    Alert.alert('Eliminar archivo', '¿Desea quitar el archivo adjunto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await eliminarArchivoLocal(
                contexto.uuidBase,
                contexto.idPregunta,
                contexto.uuidFila,
              );
              setUriLocal(null);
              onChangeText('');
              onBlur();
            } catch (error) {
              const detalle = error instanceof Error ? error.message : String(error);
              console.error(`❌ [Multimedia] No se pudo eliminar: ${detalle}`);
            }
          })();
        },
      },
    ]);
  };

  // ---------------------------------------------------------------- Estado vacío
  if (!token) {
    return (
      <TouchableOpacity
        disabled={!esEditable || cargando}
        onPress={() => { void capturar(); }}
        className={`p-4 border-2 border-dashed rounded-xl flex-row items-center justify-between ${
          !esEditable ? 'bg-gray-50 border-gray-200' : 'bg-blue-50/50 border-blue-200'
        }`}
      >
        <View className="flex-1 mr-2">
          <Text className="text-gray-400 text-xs font-bold uppercase tracking-wider">
            {presentacion.etiqueta}
          </Text>
          <Text className="text-gray-700 font-medium mt-0.5">
            {cargando ? 'Procesando archivo…' : presentacion.accion}
          </Text>
        </View>
        <View
          className={`p-3 rounded-full shadow-sm ${
            !esEditable || cargando ? 'bg-gray-400' : 'bg-[#1E3A8A]'
          }`}
        >
          {cargando ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Feather name={presentacion.icono} size={20} color="white" />
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // ---------------------------------------------------------------- Con archivo
  return (
    <View className="p-3 border-2 rounded-xl bg-emerald-50 border-emerald-200">
      <View className="flex-row items-center">
        {esImagen && uriLocal ? (
          // La miniatura se referencia por URI. Al reemplazar el archivo el nombre
          // cambia (lleva el epoch), de modo que React Native no puede servir el
          // bitmap anterior desde su caché.
          <Image
            source={{ uri: uriLocal }}
            className="w-14 h-14 rounded-lg bg-gray-200"
            resizeMode="cover"
          />
        ) : (
          <View className="w-14 h-14 rounded-lg bg-white items-center justify-center border border-emerald-200">
            <Feather name={presentacion.icono} size={22} color="#059669" />
          </View>
        )}

        <View className="flex-1 mx-3">
          <Text className="text-gray-800 font-medium text-sm" numberOfLines={1}>
            {token.nombreVisible}
          </Text>
          <Text className="text-gray-500 text-xs mt-0.5">
            {formatearTamanio(token.bytes)}
            {estadoSubida === ESTADO_SUBIDA.SUBIDO ? ' · Enviado' : ' · Pendiente de envío'}
          </Text>
        </View>

        {esEditable && (
          <View className="flex-row">
            <TouchableOpacity
              disabled={cargando}
              onPress={() => { void capturar(); }}
              className="p-2.5 rounded-full bg-white border border-emerald-200 mr-2"
            >
              {cargando ? (
                <ActivityIndicator size="small" color="#059669" />
              ) : (
                <Feather name="refresh-cw" size={16} color="#059669" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={eliminar}
              className="p-2.5 rounded-full bg-white border border-red-200"
            >
              <Feather name="trash-2" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* El archivo sube en un ciclo INDEPENDIENTE del envío de la encuesta. Decirlo
          explícitamente evita que el asesor dé por terminado su trabajo y libere
          espacio o formatee el equipo con evidencia todavía en cola. */}
      {estadoSubida !== ESTADO_SUBIDA.SUBIDO && (
        <View className="flex-row items-center mt-2 pt-2 border-t border-emerald-100">
          <Feather name="upload-cloud" size={12} color="#059669" />
          <Text className="text-emerald-700 text-[11px] ml-1.5 flex-1">
            Se enviará en la próxima sincronización.
          </Text>
        </View>
      )}
    </View>
  );
};
