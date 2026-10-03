<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { fetchMe } from '@/api/auth';

/**
 * 首页：欢迎信息 + 后端连通性自检。
 * 连通性用 /api/auth/me 探测 —— 比探 actuator 更贴近真实业务链路
 * （代理、鉴权、序列化一整条都过一遍），且不依赖 actuator 是否选型。
 */
const auth = useAuthStore();
const backendOk = ref<boolean | null>(null);

onMounted(async () => {
  try {
    await fetchMe();
    backendOk.value = true;
  } catch {
    backendOk.value = false;
  }
});
</script>

<template>
  <div>
    <el-card>
      <h2 class="hello">你好，{{ auth.user?.nickname || auth.user?.username }}</h2>
      <p class="sub">这是由脚手架装配台生成的管理端骨架 —— 从这里开始写你的业务。</p>
    </el-card>

    <el-card class="mt">
      <template #header>后端连通性</template>
      <el-result
        v-if="backendOk === true"
        icon="success"
        title="后端可达"
        sub-title="已通过 /api/auth/me 完成一次真实业务调用"
      />
      <el-result v-else-if="backendOk === false" icon="error" title="后端不可达" sub-title="请确认后端已启动，且代理/反代指向正确" />
      <el-skeleton v-else :rows="2" animated />
    </el-card>
  </div>
</template>

<style scoped>
.hello {
  margin: 0 0 6px;
}
.sub {
  color: #909399;
  margin: 0;
}
.mt {
  margin-top: 16px;
}
</style>
