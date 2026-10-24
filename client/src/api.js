import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('portal-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(r => r, error => {
  if (error.response?.status === 401 && localStorage.getItem('portal-token')) {
    localStorage.removeItem('portal-token');
    window.dispatchEvent(new Event('portal:session-ended'));
  }
  return Promise.reject(error);
});
export const messageOf = error => error.response?.data?.message || (error.code === 'ERR_NETWORK' ? 'Unable to reach the portal API. Check the backend and try again.' : 'Something went wrong. Please try again.');
