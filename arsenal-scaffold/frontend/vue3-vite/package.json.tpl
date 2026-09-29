{
  "name": "{{artifactId}}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "{{appName}} 管理端（Vue3 + Vite + TypeScript + Element Plus）",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit -p tsconfig.json && vite build",
    "type-check": "vue-tsc --noEmit -p tsconfig.json",
    "preview": "vite preview"
  },
  "dependencies": {
    "@element-plus/icons-vue": "2.3.1",
    "axios": "1.7.7",
    "element-plus": "2.8.4",
    "pinia": "2.2.2",
    "vue": "3.4.38",
    "vue-router": "4.4.5"
  },
  "devDependencies": {
    "@types/node": "20.14.15",
    "@vitejs/plugin-vue": "5.1.4",
    "typescript": "5.5.4",
    "vite": "5.4.8",
    "vue-tsc": "2.0.29"
  }
}
