import { createDiscreteApi } from 'naive-ui';

/**
 * 全局反馈的统一出口（离散 API）：
 * - 不依赖组件树里的 n-message-provider / n-dialog-provider —— axios 拦截器、
 *   路由守卫这类「组件树之外」的代码一样能弹；
 * - message 用于操作结果提示，dialog 用于确认框；需要主题定制时在 options 里传 theme。
 * 视图组件里请统一 import 这里的 { message, dialog }，不要各自再 createDiscreteApi
 * —— 每个离散实例都是独立挂载点，多份会叠出多个浮层根。
 */
const { message, dialog } = createDiscreteApi(['message', 'dialog']);

export { message, dialog };
