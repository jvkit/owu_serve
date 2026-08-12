<script lang="ts">
  import { apiGet, apiPost, apiDelete } from '../lib/api';
  import { formatBytes } from '$shared/format';

  let collections: any[] = $state([]);
  let selectedCollectionId: string = $state('');
  let files: any[] = $state([]);
  let loading = $state(false);
  let error = $state('');
  let uploadProgress = $state('');
  let newCollectionName = $state('');
  let dragging = $state(false);

  async function loadCollections() {
    try {
      const data = await apiGet('/api/files/collections');
      collections = data.collections || [];
      if (collections.length > 0 && !selectedCollectionId) {
        selectedCollectionId = collections[0].id;
      }
    } catch (e: any) {
      error = e.message;
    }
  }

  async function loadFiles(silent = false) {
    if (!selectedCollectionId) return;
    if (!silent) loading = true;
    try {
      const data = await apiGet('/api/files/list', { collectionId: selectedCollectionId });
      files = data.files || [];
    } catch (e: any) {
      error = e.message;
    } finally {
      if (!silent) loading = false;
    }
  }

  async function createCollection() {
    if (!newCollectionName.trim()) return;
    try {
      await apiPost('/api/files/collections', { name: newCollectionName.trim() });
      newCollectionName = '';
      await loadCollections();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function deleteCollection(id: string) {
    if (!confirm('确定删除这个知识库吗？')) return;
    try {
      await apiDelete(`/api/files/collections/${id}`);
      if (selectedCollectionId === id) selectedCollectionId = '';
      await loadCollections();
      await loadFiles();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const selected = Array.from(input.files || []);
    if (selected.length === 0 || !selectedCollectionId) return;
    for (const file of selected) {
      await uploadFile(file);
    }
    input.value = '';
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragging = false;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (!dropped.length || !selectedCollectionId) {
      if (!selectedCollectionId) error = '请先创建或选择一个知识库';
      return;
    }
    error = '';
    for (const file of dropped) {
      await uploadFile(file);
    }
  }

  async function uploadFile(file: File) {
    const { email, token } = (() => {
      try {
        return {
          email: localStorage.getItem('gw_email') || '',
          token: localStorage.getItem('gw_token') || '',
        };
      } catch {
        return { email: '', token: '' };
      }
    })();

    const form = new FormData();
    form.append('file', file);
    form.append('collectionId', selectedCollectionId);
    form.append('name', file.name);
    form.append('email', email);
    form.append('token', token);
    form.append('duplicateAction', 'create');

    uploadProgress = `上传 ${file.name} 中...`;
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      await loadFiles(true);
      startPolling();
      uploadProgress = `${file.name} 上传成功，后台解析中...`;
      setTimeout(() => (uploadProgress = ''), 3000);
    } catch (e: any) {
      uploadProgress = '';
      error = e.message;
    }
  }

  async function deleteFile(id: string) {
    if (!confirm('确定删除这个文件吗？')) return;
    try {
      await apiDelete(`/api/files/${id}`);
      await loadFiles();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function retryFile(id: string) {
    try {
      await apiPost(`/api/files/${id}/retry-parse`);
      await loadFiles(true);
      startPolling();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function rebuildFile(id: string) {
    try {
      await apiPost(`/api/files/${id}/rebuild`);
      await loadFiles(true);
      startPolling();
    } catch (e: any) {
      error = e.message;
    }
  }

  // 文件是否仍在处理中（需要继续轮询）
  function isActiveFile(f: any): boolean {
    const s = f.status;
    const os = f.owuStatus;
    return s === 'uploading' || s === 'parsing' || os === 'build_queued' || os === 'build_pending';
  }

  // 合并 status（gateway 解析）+ owuStatus（同步 OWU）为完整展示状态
  function displayStatus(f: any): { label: string; progress: number | null; done: boolean; failed: boolean } {
    const s = f.status;
    const os = f.owuStatus;
    if (s === 'uploading') return { label: '上传中', progress: f.uploadProgress, done: false, failed: false };
    if (s === 'queued') return { label: '等待上传', progress: 0, done: false, failed: false };
    if (s === 'uploaded') return { label: '等待解析', progress: 0, done: false, failed: false };
    if (s === 'parsing') return { label: '解析中', progress: f.parseProgress, done: false, failed: false };
    if (s === 'parse_failed') return { label: '解析失败', progress: null, done: false, failed: true };
    if (os === 'build_queued') return { label: '等待同步到 OWU', progress: null, done: false, failed: false };
    if (os === 'build_pending') return { label: '同步到 OWU 中', progress: null, done: false, failed: false };
    if (os === 'build_failed') return { label: '同步 OWU 失败', progress: null, done: false, failed: true };
    if (os === 'build_done') return { label: '已完成', progress: 100, done: true, failed: false };
    return { label: '已解析', progress: 100, done: false, failed: false };
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // 上传后定时刷新文件列表，直到所有文件处理结束才停
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      await loadFiles(true);
      if (!files.some(isActiveFile) && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 4000);
  }

  $effect(() => {
    loadCollections();
  });

  $effect(() => {
    loadFiles();
  });
</script>

<section class="card">
  <h2>我的知识库</h2>

  {#if error}<p class="error">{error}</p>{/if}

  <!-- 知识库选择（紧凑工具栏） -->
  <div class="kb-toolbar">
    <select bind:value={selectedCollectionId}>
      {#each collections as c}
        <option value={c.id}>{c.name}{c.isDefault ? '（默认）' : ''}</option>
      {/each}
    </select>
    <input type="text" placeholder="新建知识库名称" bind:value={newCollectionName} />
    <button onclick={createCollection}>创建</button>
    <button class="danger" onclick={() => deleteCollection(selectedCollectionId)} disabled={!selectedCollectionId}>
      删除
    </button>
  </div>

  <!-- 上传区（突出 + 拖拽） -->
  <div
    class="upload-area"
    class:active={dragging}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
  >
    <input type="file" multiple onchange={handleFileUpload} />
    <span class="upload-icon">⬆</span>
    <span class="upload-title">点击选择 或 拖拽文件到此处上传</span>
    <span class="upload-hint">支持 PDF、DOCX、PPTX、XLSX、STEP、STP，以及多种纯文本格式</span>
  </div>
  {#if uploadProgress}<p class="muted upload-tip">{uploadProgress}</p>{/if}

  <!-- 文件列表 -->
  <div class="section">
    <h3>文件列表</h3>
    {#if loading}
      <p class="muted">加载中...</p>
    {:else if files.length === 0}
      <p class="muted">暂无文件，上传后会自动解析并同步到对话知识库</p>
    {:else}
      <table class="file-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>大小</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each files as f}
            {@const st = displayStatus(f)}
            <tr>
              <td>{f.name}</td>
              <td>{formatBytes(f.size || 0)}</td>
              <td>
                {#if !st.done && !st.failed && st.progress !== null}
                  <div class="bar file-progress"><div class="bar-fill" style="width: {st.progress}%;"></div></div>
                  <span class="muted">{st.label} {st.progress}%</span>
                {:else if !st.done && !st.failed}
                  <div class="bar file-progress"><div class="bar-fill indeterminate"></div></div>
                  <span class="muted">{st.label}</span>
                {:else}
                  <span class="status-text" class:done={st.done} class:failed={st.failed}>{st.label}</span>
                {/if}
                {#if f.error || f.owuError}
                  <span class="muted" title={f.error || f.owuError}> ⚠</span>
                {/if}
              </td>
              <td>
                <button class="small" onclick={() => retryFile(f.id)} disabled={f.status !== 'parse_failed'}>重试</button>
                <button class="small" onclick={() => rebuildFile(f.id)} disabled={f.status !== 'build_failed'}>重建</button>
                <button class="small danger" onclick={() => deleteFile(f.id)}>删除</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>

<style>
  .kb-toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .kb-toolbar select {
    flex: 0 0 auto;
    min-width: 140px;
  }

  .kb-toolbar input {
    flex: 1 1 180px;
    margin: 0;
    min-width: 0;
  }

  .upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 2rem 1rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    text-align: center;
    color: var(--muted);
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    margin-bottom: 1rem;
  }

  .upload-area:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .upload-area.active {
    border-color: var(--primary);
    background: #eff6ff;
    color: var(--primary);
  }

  .upload-area input[type="file"] {
    display: none;
  }

  .upload-icon {
    font-size: 1.6rem;
    line-height: 1;
  }

  .upload-title {
    font-size: 1rem;
    font-weight: 600;
  }

  .upload-hint {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .upload-tip {
    margin-top: -0.5rem;
    margin-bottom: 1rem;
  }

  .file-progress {
    width: 120px;
    margin-bottom: 0.25rem;
  }

  .bar-fill.indeterminate {
    width: 40%;
    animation: indeterminate 1.4s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { margin-left: -40%; }
    100% { margin-left: 100%; }
  }

  .status-text.done {
    color: #16a34a;
  }

  .status-text.failed {
    color: var(--danger);
  }
</style>
