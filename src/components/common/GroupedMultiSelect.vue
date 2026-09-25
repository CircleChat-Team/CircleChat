<script lang="ts">
/** 分组多选的入参结构（放这里是因为 <script setup> 里不允许 export） */
export interface MsOption {
  value: string;
  label: string;
}
export interface MsGroup {
  key: string;
  label: string;
  options: MsOption[];
}
</script>

<script setup lang="ts">
/* ============================================================
 * 分组多选下拉
 *
 * 原来是原生 <select>（单选），选项一多就没法用：只能看一个类别、也不能组合。
 * 这里改成下拉面板：
 *  - 按组展示，每组一个三态复选框（全选 / 半选 / 全不选）
 *  - 组内每一项也能单独勾选，所以「选一个类别」和「跨类别挑几项」都行
 *  - 顶部有全选 / 清空，右侧显示已选数量
 * 触发器上的文案会跟着变：没选=全部、正好选中一整组=组名、其它=已选 N 项
 *
 * 纯展示组件：文案都由父组件传进来（不 import i18n），避免把组件绑死在某一处用法上。
 * ============================================================ */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useOverlay } from '../../core/useOverlay';

const props = defineProps<{
  groups: MsGroup[];
  modelValue: string[];
  allLabel: string;
  selectAllLabel: string;
  clearLabel: string;
  /**
   * 「已选 N 项」的文案生成器。
   * 不能传一段带 {n} 的字符串让组件自己 replace：i18n 的 vt() 在没有传入变量时
   * 会把占位符直接吞掉（实测界面显示成「已选  项」），必须由父组件用 tr(key, { n }) 插值。
   */
  selectedText: (n: number) => string;
  titleLabel?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string[]] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const selected = computed<string[]>(() => props.modelValue || []);
const allValues = computed<string[]>(() => props.groups.flatMap((g) => g.options.map((o) => o.value)));

function has(v: string): boolean {
  return selected.value.indexOf(v) !== -1;
}

/** 组的三态：全选 / 半选（部分）/ 未选 */
function groupState(g: MsGroup): { all: boolean; part: boolean; n: number } {
  const n = g.options.filter((o) => has(o.value)).length;
  return { all: n > 0 && n === g.options.length, part: n > 0 && n < g.options.length, n };
}

function toggleOne(v: string): void {
  const next = selected.value.slice();
  const i = next.indexOf(v);
  if (i === -1) next.push(v);
  else next.splice(i, 1);
  emit('update:modelValue', next);
}

/** 整组切换：已经全选就取消整组，否则补齐整组（半选时点一下=全选，符合直觉） */
function toggleGroup(g: MsGroup): void {
  const vals = g.options.map((o) => o.value);
  if (groupState(g).all) {
    emit('update:modelValue', selected.value.filter((v) => vals.indexOf(v) === -1));
    return;
  }
  const next = selected.value.slice();
  vals.forEach((v) => {
    if (next.indexOf(v) === -1) next.push(v);
  });
  emit('update:modelValue', next);
}

function selectAll(): void {
  emit('update:modelValue', allValues.value.slice());
}

function clearAll(): void {
  emit('update:modelValue', []);
}

const summary = computed(() => {
  const n = selected.value.length;
  if (!n) return props.allLabel;
  // 正好选中「整个一个组」时，直接显示组名，比「已选 8 项」直观
  const full = props.groups.find(
    (g) => g.options.length > 0 && groupState(g).all && n === g.options.length
  );
  return full ? full.label : props.selectedText(n);
});

// 点面板外面收起（下拉不该锁背景滚动，所以 lockScroll: false）
function onDocDown(e: MouseEvent): void {
  if (!open.value) return;
  const el = root.value;
  if (el && !el.contains(e.target as Node)) open.value = false;
}
document.addEventListener('mousedown', onDocDown);
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown));
useOverlay({
  isOpen: () => open.value,
  onClose: () => {
    open.value = false;
  },
  lockScroll: false
});
</script>

<template>
  <div ref="root" class="grouped-ms relative">
    <button
      type="button"
      class="grouped-ms-trigger flex h-7.5 max-w-56 items-center gap-1 rounded-lg border bg-fill px-2.5 text-xs transition-colors"
      :class="selected.length ? 'border-primary/50 text-primary' : 'border-line hover:border-primary hover:text-primary'"
      :title="titleLabel || allLabel"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="truncate">{{ summary }}</span>
      <svg class="h-3 w-3 shrink-0 opacity-60" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
      </svg>
    </button>

    <div
      v-if="open"
      class="grouped-ms-panel absolute right-0 z-40 mt-1 max-h-80 w-80 overflow-y-auto rounded-xl border border-line bg-panel p-2 shadow-xl"
    >
      <div class="mb-1.5 flex items-center gap-1.5 border-b border-line pb-1.5">
        <button
          type="button"
          class="rounded-md bg-fill px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
          @click="selectAll"
        >{{ selectAllLabel }}</button>
        <button
          type="button"
          class="rounded-md bg-fill px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
          @click="clearAll"
        >{{ clearLabel }}</button>
        <span class="grouped-ms-count ml-auto pr-0.5 text-[11px] text-muted tabular-nums">{{ selected.length }}/{{ allValues.length }}</span>
      </div>

      <div v-for="g in groups" :key="g.key" class="grouped-ms-group border-b border-line/60 px-0.5 py-1.5 last:border-b-0">
        <label class="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
            :checked="groupState(g).all"
            :indeterminate.prop="groupState(g).part"
            @change="toggleGroup(g)"
          >
          <span class="truncate">{{ g.label }}</span>
          <span class="grouped-ms-gcount ml-auto shrink-0 text-[11px] font-normal text-muted tabular-nums">
            {{ groupState(g).n }}/{{ g.options.length }}
          </span>
        </label>

        <div class="mt-1 flex flex-wrap gap-1 pl-5">
          <label
            v-for="o in g.options"
            :key="o.value"
            class="grouped-ms-option flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors"
            :class="has(o.value) ? 'bg-primary/12 text-primary' : 'text-muted hover:bg-fill hover:text-ink'"
          >
            <input
              type="checkbox"
              class="h-3 w-3 shrink-0 cursor-pointer accent-primary"
              :checked="has(o.value)"
              @change="toggleOne(o.value)"
            >
            <span>{{ o.label }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
