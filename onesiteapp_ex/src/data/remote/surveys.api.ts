import { apiClient } from '../../core/network/apiClient';

/**
 * La función envía el JSON consolidado al servidor.
 */
export const submitSurveyApi = async (payload: any) => {
  const response = await apiClient.post('/surveys/submit', payload);
  return response.data;
};