import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, FlatList, Dimensions, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { apiClientAuth, registrarFalloHttp } from '../../../core/network/apiClient';
import { extraerData } from '../../../core/network/envelope';
import { COLORES } from '../../theme/colores';

const { width } = Dimensions.get('window');
// Tarjeta al 92% de la pantalla: asoma la siguiente sin robar ancho al texto
const CARD_WIDTH = width * 0.92;
// 16 equivale al mr-4 de Tailwind
const CARD_MARGIN = 16;
// Alto mínimo para que una noticia corta no encoja la tarjeta y el carrusel brinque
const CARD_MIN_HEIGHT = 380;

/**
 * Base del API de HVC Kapital, que sirve el carrusel desde la Fase 4. Se usa solo
 * para armar la URL de la imagen: el listado va por `apiClientAuth`, que ya la
 * tiene. Se toma del entorno para no quemar una IP de red interna en el código.
 */
const CARRUSEL_API_URL = process.env.EXPO_PUBLIC_API_AUTH_URL;

/** Contrato del banner tal como lo expone el servicio de configuración. */
interface BannerCarrusel {
  carouselId: string;
  titulo: string;
  subtitulo: string | null;
  descripcion: string | null;
  fotoUrl: string | null;
  redireccionUrl: string | null;
  fechaInicio: string | null;
  orden: number;
  activo: boolean;
  visibleApp: boolean;
}

/**
 * Type guard defensivo: la respuesta HTTP es impredecible, por lo que cada
 * elemento se valida antes de incorporarlo al estado.
 */
const esBannerValido = (dato: unknown): dato is BannerCarrusel => {
  if (typeof dato !== 'object' || dato === null) return false;
  const posible = dato as Record<string, unknown>;
  return typeof posible.carouselId === 'string' && typeof posible.titulo === 'string';
};

export const DynamicCarousel = () => {
  const [carousels, setCarousels] = useState<BannerCarrusel[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  // El "control remoto" para mover el carrusel automáticamente
  const flatListRef = useRef<FlatList<BannerCarrusel>>(null);

  // 1. Efecto para descargar los datos
  useEffect(() => {
    const fetchCarousel = async () => {
      // Sin configuración de entorno el componente se degrada en silencio
      // (no renderiza) en lugar de intentar una IP inexistente.
      if (!CARRUSEL_API_URL) {
        console.warn('[CARRUSEL] EXPO_PUBLIC_API_AUTH_URL no está definida; el carrusel no se mostrará.');
        setLoading(false);
        return;
      }

      try {
        // El servidor ya filtra por audiencia (TipoUsuario del token) y vigencia;
        // aquí solo queda lo que es para la app, que él no decide.
        const response = await apiClientAuth.get<unknown>('/config/carrusel/obtener');
        const datos = extraerData<unknown[]>(response.data, 'Carrusel');

        if (Array.isArray(datos)) {
          const activos = datos
            .filter(esBannerValido)
            .filter((banner) => banner.activo && banner.visibleApp)
            .sort((a, b) => a.orden - b.orden);
          setCarousels(activos);
        }
      } catch (error) {
        registrarFalloHttp('CARRUSEL', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCarousel();
  }, []);

  //Motor de Auto-Play (Se mueve cada 4 segundos)
  useEffect(() => {
    if (carousels.length <= 1) return; // Si solo hay 1 imagen, no tiene sentido moverlo

    const timer = setInterval(() => {
      // Calculamos la siguiente tarjeta (si llega al final, regresa al inicio)
      const nextIndex = (currentIndex + 1) % carousels.length;
      
      // Movemos el scroll físicamente
      flatListRef.current?.scrollToOffset({
        offset: nextIndex * (CARD_WIDTH + CARD_MARGIN),
        animated: true,
      });
      
      setCurrentIndex(nextIndex);
    }, 5000); 

    return () => clearInterval(timer);
  }, [currentIndex, carousels.length]);

  /**
   * `fotoUrl` llega como ruta relativa ("storage/carrusel/banner.png"). La ruta del
   * API es pública a propósito: <Image> no envía cabeceras, así que un endpoint con
   * token dejaría las imágenes en blanco.
   */
  const resolveImageUrl = (url: string | null): string => {
    if (!url) return 'https://via.placeholder.com/400x200?text=Sin+Imagen';
    if (url.startsWith('http')) return url;
    if (!CARRUSEL_API_URL) return 'https://via.placeholder.com/400x200?text=Sin+Imagen';
    const archivo = url.split('/').pop() ?? '';
    return `${CARRUSEL_API_URL}/config/carrusel/imagen/${encodeURIComponent(archivo)}`;
  };

  if (loading) {
    return (
      <View className="h-48 justify-center items-center">
        <ActivityIndicator size="large" color={COLORES.navy} />
      </View>
    );
  }

  if (carousels.length === 0) return null;

  return (
    <View className="my-2 mb-4">
      <FlatList
        ref={flatListRef} // Conectamos el control remoto
        data={carousels}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_MARGIN}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}
        keyExtractor={(item) => item.carouselId}
        onScrollBeginDrag={() => setCurrentIndex(-1)}
        onMomentumScrollEnd={(evento) => {
          const desplazamiento = evento.nativeEvent.contentOffset.x;
          setCurrentIndex(Math.round(desplazamiento / (CARD_WIDTH + CARD_MARGIN)));
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => item.redireccionUrl ? Linking.openURL(item.redireccionUrl) : null}
            // El alto mínimo iguala las tarjetas; el texto largo la deja crecer
            style={{ width: CARD_WIDTH, minHeight: CARD_MIN_HEIGHT }}
            className="bg-white rounded-[20px] mr-4 p-5 shadow-sm border border-gray-100 elevation-3"
          >
            {/* 1. Título */}
            <Text className="text-brand-blue font-inter-bold text-xl leading-7 mb-4" numberOfLines={2}>
              {item.titulo}
            </Text>

            {/* 2. Ilustración a todo lo ancho */}
            <View className="h-[170px] rounded-2xl bg-brand-light overflow-hidden mb-4">
              <Image
                source={{ uri: resolveImageUrl(item.fotoUrl) }}
                className="w-full h-full"
                resizeMode="cover"
              />
            </View>

            {/* 3. Cuerpo y firma, separados por una línea sutil */}
            <Text className="text-brand-navy text-sm font-sans leading-5" numberOfLines={6}>
              {item.descripcion}
            </Text>

            <View className="flex-1 justify-end">
              <View className="border-t border-gray-100 mt-4 pt-3">
                <Text className="text-brand-steel text-xs font-sans">
                  {item.subtitulo ? `Por: ${item.subtitulo}` : 'HVC Kapital'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Puntos de paginación: naranja el activo, gris los demás. */}
      {carousels.length > 1 && (
        <View className="flex-row justify-center mt-3" style={{ gap: 8 }}>
          {carousels.map((banner, indice) => (
            <View
              key={banner.carouselId}
              className={`w-2 h-2 rounded-full ${indice === currentIndex ? 'bg-brand-orange' : 'bg-brand-mist'}`}
            />
          ))}
        </View>
      )}
    </View>
  );
};