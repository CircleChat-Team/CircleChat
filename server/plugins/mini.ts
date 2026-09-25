/* 启动时预热小程序索引：合并官方源与第三方源，失败只记日志不影响启动。 */
import * as mini from '../lib/mini';

export default defineNitroPlugin(async () => {
  try {
    mini.load();
    const idx = await mini.refreshIndex();
    console.log('[mini] 索引已加载：' + idx.apps.length + ' 个小程序，' + idx.sources.length + ' 个源');
  } catch (e) {
    console.error('[mini] 索引预热失败', e);
  }
});
