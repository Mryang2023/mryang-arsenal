import axios, { AxiosError } from 'axios';
import { message } from './feedback';
import type { ApiResponse } from '@/types/api';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** true = 本请求失败不弹全局错误提示（用于可降级的探测型接口，如菜单获取） */
    silent?: boolean;
  }
}

/**
 * axios 实例：
 * - baseURL 走同源 /api（开发期 vite 代理、生产 nginx 反代），浏览器侧没有跨域问题；
 * - 请求拦截注入 Bearer token；
 * - 响应拦截统一拆包：code!==0 弹错并 reject，调用方只拿业务数据；
 * - 401 说明登录态已失效：清掉本地凭据回登录页。清 token 必须先于跳转，
 *   否则路由守卫读到旧 token 又放行，出现「登录页循环」。
 */
const http = axios.create({
  baseURL: `${(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')}/api`,
  timeout: 10_000,
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (resp) => {
    const body = resp.data as ApiResponse<unknown>;
    // 拦截器里拿到的都是后端统一包装：code!==0 一律按失败处理
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) {
        message.error(body.message || '请求失败');
        return Promise.reject(new Error(body.message));
      }
      return body.data as never;
    }
    return resp;
  },
  (error: AxiosError<ApiResponse<unknown>>) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      if (window.location.pathname !== '/login') window.location.href = '/login';
      message.error('登录已过期，请重新登录');
      return Promise.reject(error);
    }
    if (!error.config?.silent) {
      const msg = error.response?.data?.message || error.message || '网络异常';
      message.error(msg);
    }
    return Promise.reject(error);
  },
);

export default http;
