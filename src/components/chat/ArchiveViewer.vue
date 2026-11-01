<script setup lang="ts">
/* ============================================================
 * 压缩包在线浏览（ZIP / TAR / TAR.GZ）
 *
 * 左侧条目列表，右侧按需解压预览：
 *   - 文本：按 UTF-8 解码，超过 200KB 只显示前 200KB；
 *   - 图片/音频/视频：用 blob URL 交给标签渲染；
 *   - PDF：用 blob iframe 交给浏览器阅读器；
 *   - 其它二进制：提示下载。
 *
 * 所有解压都受 core/archive.ts 的硬上限约束（压缩包 20MB、单条目 2MB），
 * 超限立即取消，不会把浏览器卡死。
 * ============================================================ */
import { ref, watch, onBeforeUnmount } from 'vue';
import { tr } from '../../core/i18n';
import { fmtSize } from '../../core/format';
import { decodeBytes, looksLikePdf, sniffKind, sniffMedia } from '../../core/fileview';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_PREVIEW_BYTES,
  archiveSupported,
  listArchive,
  readArchiveEntry,
  type ArchiveEntry,
  type ArchiveKind
} from '../../core/archive';

const props = defineProps<{
  bytes: Uint8Array | null;
  kind: ArchiveKind | null;
  name?: string;
}>();

/** 文本预览最多显示这么多字符（字节级解压上限是 2MB，DOM 还要再收一道） */
const TEXT_PREVIEW_BYTES = 200 * 1024;

const loading = ref(true);
const err = ref('');
const unsupported = ref(false);
const entries = ref<ArchiveEntry[]>([]);
const truncated = ref(false);
const selected = ref<ArchiveEntry | null>(null);

/** 预览状态（拆成独立 ref，避免模板里对联合类型做收窄） */
const pv = ref<'idle' | 'loading' | 'text' | 'media' | 'pdf' | 'binary' | 'too-large' | 'error'>('idle');
const pvText = ref('');
const pvTruncated = ref(false);
const pvMedia = ref<'image' | 'audio' | 'video'>('image');
const pvSize = ref(0);
const pvError = ref('');
const blobUrl = ref('');
const downloadName = ref('');

/** gzip 解压后的 tar 字节（读取条目用）；zip/tar 直接读原压缩包 */
let sourceBytes: Uint8Array = new Uint8Array(0);
/** 选择序号：快速连点不同条目时丢弃旧结果 */
let seq = 0;

function baseName(n: string): string {
  const s = String(n || '').replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1) || s;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  xml: 'application/xml', csv: 'text/csv', log: 'text/plain'
};

function mimeOf(name: string): string {
  const s = String(name || '').toLowerCase();
  const i = s.lastIndexOf('.');
  return (i >= 0 ? MIME_BY_EXT[s.slice(i + 1)] : '') || 'application/octet-stream';
}

function revokeBlob(): void {
  if (!blobUrl.value) return;
  try {
    URL.revokeObjectURL(blobUrl.value);
  } catch {
    /* ignore */
  }
  blobUrl.value = '';
}

function resetPreview(): void {
  revokeBlob();
  pv.value = 'idle';
  pvText.value = '';
  pvTruncated.value = false;
  pvSize.value = 0;
  pvError.value = '';
  downloadName.value = '';
}

async function load(): Promise<void> {
  seq++; // 作废上一个压缩包里还在解压中的选择
  resetPreview();
  sourceBytes = new Uint8Array(0);
  selected.value = null;
  entries.value = [];
  truncated.value = false;
  unsupported.value = false;
  err.value = '';
  loading.value = true;

  const kind = props.kind;
  const bytes = props.bytes;
  if (!kind) {
    loading.value = false;
    err.value = 'fileview.archiveFailed';
    return;
  }
  // RAR/7Z/XZ/BZIP2：FileViewer 不会再下载，直接提示下载
  if (!archiveSupported(kind) || !bytes) {
    unsupported.value = true;
    loading.value = false;
    return;
  }

  try {
    const listing = await listArchive(bytes, kind, props.name);
    sourceBytes = listing.payload || bytes;
    entries.value = listing.entries;
    truncated.value = listing.truncated;
    unsupported.value = !!listing.unsupported;
    if (!entries.value.length && !unsupported.value) err.value = 'fileview.archiveEmpty';
  } catch (e) {
    const msg = (e as Error)?.message;
    err.value =
      msg === 'too-large'
        ? 'fileview.archiveExpandedTooLarge'
        : msg === 'no-decompress'
          ? 'fileview.archiveNoDecompress'
          : 'fileview.archiveFailed';
  } finally {
    loading.value = false;
  }
}

async function selectEntry(e: ArchiveEntry): Promise<void> {
  const kind = props.kind;
  if (!kind) return;
  const my = ++seq;
  selected.value = e;
  resetPreview();
  pv.value = 'loading';
  pvSize.value = e.size;

  if (e.unsupported) {
    pv.value = 'error';
    pvError.value = 'fileview.archiveEntryFailed';
    return;
  }
  if (e.size > MAX_ENTRY_PREVIEW_BYTES) {
    pv.value = 'too-large';
    return;
  }

  try {
    const data = await readArchiveEntry(sourceBytes, kind, e);
    if (my !== seq) return;

    const pdf = looksLikePdf(data);
    const media = pdf ? null : sniffMedia(data);
    // blob 的 MIME 优先按内容嗅探修正：条目名可能没有扩展名或扩展名不可靠
    let type = mimeOf(e.name);
    if (pdf) type = 'application/pdf';
    else if (media === 'image' && !type.startsWith('image/')) type = 'image/png';
    else if (media === 'audio' && !type.startsWith('audio/')) type = 'audio/mpeg';
    else if (media === 'video' && !type.startsWith('video/')) type = 'video/mp4';
    // new Uint8Array(data) 复制到独立 ArrayBuffer，满足 BlobPart 的类型要求
    blobUrl.value = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }));
    downloadName.value = baseName(e.name);
    pvSize.value = data.length;

    if (pdf) {
      pv.value = 'pdf';
      return;
    }
    if (media) {
      pvMedia.value = media;
      pv.value = 'media';
      return;
    }
    if (sniffKind(data.subarray(0, 8192)) === 'binary') {
      pv.value = 'binary';
      return;
    }
    let text = decodeBytes(data);
    pvTruncated.value = text.length > TEXT_PREVIEW_BYTES;
    if (pvTruncated.value) text = text.slice(0, TEXT_PREVIEW_BYTES);
    pvText.value = text;
    pv.value = 'text';
  } catch (e2) {
    if (my !== seq) return;
    const msg = (e2 as Error)?.message;
    pv.value = 'error';
    pvError.value =
      msg === 'too-large'
        ? 'fileview.archiveEntryTooLarge'
        : msg === 'no-decompress'
          ? 'fileview.archiveNoDecompress'
          : 'fileview.archiveEntryFailed';
  }
}

watch(() => [props.bytes, props.kind, props.name], () => { void load(); }, { immediate: true });

onBeforeUnmount(() => {
  seq++;
  revokeBlob();
});
</script>

<template>
  <div class="arc-wrap">
    <div class="arc-list">
      <div class="arc-summary">
        {{ tr('fileview.archiveFiles', { n: entries.length }) }}
        <span v-if="truncated"> · {{ tr('fileview.archiveTruncated', { n: MAX_ARCHIVE_ENTRIES }) }}</span>
      </div>

      <button
        v-for="e in entries"
        :key="e.index"
        type="button"
        class="arc-row"
        :class="{ on: selected && selected.index === e.index, dim: !!e.unsupported }"
        :title="e.name"
        @click="selectEntry(e)"
      >
        <span class="arc-ico" aria-hidden="true">{{ e.unsupported ? '🔒' : '📄' }}</span>
        <span class="arc-name">{{ e.name }}</span>
        <span class="arc-size">{{ fmtSize(e.size) }}</span>
      </button>

      <p v-if="loading" class="arc-empty">{{ tr('fileview.loading') }}</p>
      <p v-else-if="!entries.length && !err && !unsupported" class="arc-empty">{{ tr('fileview.archiveEmpty') }}</p>
    </div>

    <div class="arc-preview">
      <p v-if="unsupported" class="arc-empty">{{ tr('fileview.archiveUnsupported') }}</p>
      <p v-else-if="err" class="arc-empty">{{ tr(err) }}</p>
      <p v-else-if="!selected" class="arc-empty">{{ tr('fileview.archivePick') }}</p>
      <template v-else>
        <div class="arc-prev-head">
          <span class="arc-prev-name" :title="selected.name">{{ selected.name }}</span>
          <a v-if="blobUrl" class="fv-btn" :href="blobUrl" :download="downloadName">{{ tr('fileview.download') }}</a>
        </div>

        <p v-if="pv === 'loading'" class="arc-empty">{{ tr('fileview.loading') }}</p>
        <p v-else-if="pv === 'too-large'" class="arc-empty">
          {{ tr('fileview.archiveEntryTooLarge', { size: fmtSize(MAX_ENTRY_PREVIEW_BYTES) }) }}
        </p>
        <p v-else-if="pv === 'error'" class="arc-empty">{{ tr(pvError) }}</p>
        <p v-else-if="pv === 'binary'" class="arc-empty">
          {{ tr('fileview.archiveBinary', { size: fmtSize(pvSize) }) }}
        </p>
        <template v-else-if="pv === 'text'">
          <pre class="arc-text">{{ pvText }}</pre>
          <p v-if="pvTruncated" class="arc-note">
            {{ tr('fileview.archiveTextTruncated', { size: fmtSize(TEXT_PREVIEW_BYTES) }) }}
          </p>
        </template>
        <div v-else-if="pv === 'media'" class="arc-media">
          <img v-if="pvMedia === 'image'" :src="blobUrl" alt="" />
          <audio v-else-if="pvMedia === 'audio'" :src="blobUrl" controls></audio>
          <video v-else :src="blobUrl" controls></video>
        </div>
        <iframe v-else-if="pv === 'pdf'" class="arc-pdf" :src="blobUrl" :title="selected.name"></iframe>
      </template>
    </div>
  </div>
</template>
