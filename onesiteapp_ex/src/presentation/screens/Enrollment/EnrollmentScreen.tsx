import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { enrollDeviceApi, updateMetadataApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';

export const EnrollmentScreen = () => {
  const [companyCode, setCompanyCode] = useState('');
  const setEnrollment = useAuthStore((state) => state.setEnrollment);

  // 1. Mutación secundaria para enviar los metadatos (PUT)
  const metadataMutation = useMutation({
    mutationFn: updateMetadataApi,
    onError: (error) => {
      // Un error aquí no debe bloquear al usuario porque ya se enroló, 
      // pero lo registramos para monitoreo proactivo.
      console.warn("Error al sincronizar metadatos del dispositivo", error);
    }
  })

  // Configuración de TanStack Query v5 para la mutación
  const enrollMutation = useMutation({
    mutationFn: enrollDeviceApi,
    onSuccess: async (data) => {
      try {
        // 1. Persistencia Segura (Regla del Sprint 1)
        await SecureStore.setItemAsync('deviceToken', data.deviceToken);
        await SecureStore.setItemAsync('isEnrolled', 'true');
        await SecureStore.setItemAsync('companyName', data.companyName);
        
        // B. Enviar metadatos al servidor de fondo (Método ActualizarInfo)
        const deviceModel = Device.modelName || 'Unknown Model';
        const osVersion = Device.osVersion || 'Unknown OS';
        
        metadataMutation.mutate({
          deviceToken: data.deviceToken,
          modelo: deviceModel,
          versionSO: `${Platform.OS} ${osVersion}`
        });

        // C. Actualizar el estado global para que la pantalla desaparezca
        setEnrollment(data.deviceToken);

      } catch (error) {
       Alert.alert('Error Local', 'No se pudo guardar la configuración de seguridad.');
      }
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || 'Error al conectar con el servidor.';
      Alert.alert('Error de Enrolamiento', errorMsg);
    },
  });

  const handleEnroll = async () => {
    if (companyCode.trim().length < 5) {
      Alert.alert('Validación', 'El código debe tener al menos 5 caracteres.');
      return;
    }

    try {
      let hardwareId = '';
      if (Platform.OS === 'android') {
        hardwareId = Application.getAndroidId();
      } else if (Platform.OS === 'ios') {
        const iosId = await Application.getIosIdForVendorAsync();
        hardwareId = iosId ?? 'UNKNOWN_IOS_ID';
      }

      // DEPURACIÓN: Verificamos en consola qué datos estamos por enviar
      console.log('--- PREPARANDO PAYLOAD ---');
      console.log('Código:', companyCode);
      console.log('HardwareID capturado:', hardwareId);
      console.log('Longitud del HardwareID:', hardwareId.length);

      // Si el HardwareID es muy corto, le agregamos un prefijo de seguridad para cumplir con Zod
      // (Algunos emuladores generan IDs muy cortos)
      if (hardwareId.length < 10) {
        hardwareId = `ONESITEAPPEX-DEV-${hardwareId}`;
        console.log('HardwareID ajustado para Zod:', hardwareId);
      }

      // Ejecutar la mutación hacia NestJS
      enrollMutation.mutate({
        codigoEnrolamiento: companyCode,
        hardwareId: hardwareId,
      });

    } catch (error) {
      Alert.alert('Error', 'No se pudo obtener el identificador del hardware.');
      console.error('Error al capturar HardwareID:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a OneSiteApp_Ex</Text>
      <Text style={styles.subtitle}>Ingrese el código de su empresa para registrar este dispositivo.</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Ej: GT-2026-DEMO"
        value={companyCode}
        onChangeText={setCompanyCode}
        autoCapitalize="characters"
        editable={!enrollMutation.isPending}
      />

      <Button 
        title={enrollMutation.isPending ? "Validando..." : "Enrolar Equipo"} 
        onPress={handleEnroll} 
        disabled={enrollMutation.isPending || companyCode.length === 0}
      />
    </View>
  );
};

// NOTA: Mantengo los estilos nativos simples por ahora. 
// Más adelante podemos migrar esto a Tamagui o Shopify Restyle como solicitaste.
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#F5F5F5' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10, textAlign: 'center', color: '#333' },
  subtitle: { fontSize: 16, marginBottom: 30, textAlign: 'center', color: '#666' },
  input: { borderWidth: 1, borderColor: '#CCC', padding: 15, borderRadius: 8, marginBottom: 20, backgroundColor: '#FFF', fontSize: 16 },
});