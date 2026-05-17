import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, FlatList, Dimensions, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import axios from 'axios';

const { width } = Dimensions.get('window');
// Tarjeta al 85% de la pantalla para que asome la siguiente
const CARD_WIDTH = width * 0.85; 
// 16 equivale al mr-4 de Tailwind
const CARD_MARGIN = 16; 

export const DynamicCarousel = () => {
  const [carousels, setCarousels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // El "control remoto" para mover el carrusel automáticamente
  const flatListRef = useRef<FlatList>(null);

  // 1. Efecto para descargar los datos
  useEffect(() => {
    const fetchCarousel = async () => {
      try {
        const response = await axios.get('http://172.25.5.11:3000/api/config/carousel');
        if (response.data && response.data.success) {
          const activos = response.data.data.filter((c: any) => c.activo && c.visibleApp);
          const ordenados = activos.sort((a: any, b: any) => a.orden - b.orden);
          setCarousels(ordenados);
        }
      } catch (error) {
        console.error('❌ Error API Carrusel:', error);
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
    }, 5000); // 5000 milisegundos = 5 segundos

    // Limpiamos el temporizador para no causar fugas de memoria
    return () => clearInterval(timer);
  }, [currentIndex, carousels.length]);

  const resolveImageUrl = (url: string) => {
    if (!url) return 'https://via.placeholder.com/400x200?text=Sin+Imagen';
    if (url.startsWith('http')) return url;
    return `http://172.25.5.11:3000/api/config/carousel/imagen?fotoUrl=${encodeURIComponent(url)}`;
  };

  if (loading) {
    return (
      <View className="h-48 justify-center items-center">
        <ActivityIndicator size="large" color="#1E3A8A" />
      </View>
    );
  }

  if (carousels.length === 0) return null;

  return (
    <View className="my-2 mb-6">
      <FlatList
        ref={flatListRef} // Conectamos el control remoto
        data={carousels}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_MARGIN}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}
        keyExtractor={(item) => item.carouselId}
        // Desactivamos temporalmente el autoplay si el usuario lo mueve manualmente
        onScrollBeginDrag={() => setCurrentIndex(-1)} 
        renderItem={({ item }) => (
          <TouchableOpacity 
            activeOpacity={0.9}
            onPress={() => item.redireccionUrl ? Linking.openURL(item.redireccionUrl) : null}
            // Quitamos el "height" fijo para que el texto empuje la tarjeta hacia abajo
            style={{ width: CARD_WIDTH }}
            className="bg-white rounded-[32px] mr-4 shadow-sm border border-gray-100 overflow-hidden elevation-3"
          >
            {/* 1. Imagen Superior (Esta sí tiene altura fija) */}
            <View className="h-40 w-full bg-gray-200">
              <Image 
                source={{ uri: resolveImageUrl(item.fotoUrl) }}
                className="w-full h-full"
                resizeMode="cover"
              />
            </View>

            {/* 2. Textos Inferiores (Fluyen dinámicamente) */}
            <View className="p-5">
              <View className="flex-row items-center mb-2">
                <View className="w-1 h-4 bg-[#F59E0B] mr-2 rounded-full" />
                <Text className="text-gray-400 font-bold text-[10px] uppercase tracking-widest">
                  {item.subtitulo || 'CRÉDITO FUNDEA'}
                </Text>
              </View>

              <Text className="text-[#1E3A8A] font-black text-xl mb-2" numberOfLines={1}>
                {item.titulo}
              </Text>

              <Text className="text-gray-500 text-sm leading-5 mb-4" numberOfLines={3}>
                {item.descripcion}
              </Text>

              <Text className="text-gray-400 text-[10px] font-medium">
                Válido desde: {item.fechaInicio ? new Date(item.fechaInicio).toLocaleDateString() : 'Activo'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};