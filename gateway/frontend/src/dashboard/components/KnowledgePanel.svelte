<script lang="ts">
  import { apiGet, apiPost, apiDelete } from '../lib/api';
  import { formatBytes } from '$shared/format';

  let collections: any[] = $state([]);
  let selectedCollectionId: string = $state('');
  let files: any[] = $state([]);
  let view = $state<'list' | 'detail'>('list');
  let loading = $state(false);
  let error = $state('');
  let uploadProgress = $state('');
  let newCollectionName = $state('');
  let dragging = $state(false);

  const currentName = $derived(
    collections.find((c) => c.id === selectedCollectionId)?.name || ''
  );

  async function loadCollections() {
    try {
      const data = await apiGet('/api/files/collections');
      collections = data.collections || [];
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

  function openCollection(id: string) {
    selectedCollectionId = id;
    view = 'detail';
    loadFiles();
  }

  function goBack() {
    view = 'list';
    selectedCollectionId = '';
    files = [];
    loadCollections();
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
      if (selectedCollectionId === id) {
        selectedCollectionId = '';
        view = 'list';
        files = [];
      }
      await loadCollections();
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
    if (view === 'detail') loadFiles();
  });
</script>

<section class="card knowledge-card">
  <h2>我的知识库</h2>

  {#if error}<p class="error">{error}</p>{/if}

  {#if view === 'list'}
    <!-- 创建知识库 -->
    <div class="create-bar">
      <input type="text" placeholder="新建知识库名称" bind:value={newCollectionName} />
      <button onclick={createCollection} disabled={!newCollectionName.trim()}>创建知识库</button>
    </div>

    <!-- 知识库列表 -->
    {#if collections.length === 0}
      <p class="muted">暂无知识库，在上方填写名称创建一个吧</p>
    {:else}
      <div class="kb-list">
        {#each collections as c}
          <div class="kb-item">
            <div class="kb-info">
              <span class="kb-name" title={c.name}>{c.name}{c.isDefault ? '（默认）' : ''}</span>
              <span class="kb-count">{c.fileCount || 0} 个文件</span>
            </div>
            <div class="kb-actions">
              <button class="small" onclick={() => openCollection(c.id)}>查看</button>
              <button class="small danger" onclick={() => deleteCollection(c.id)}>删除</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <!-- 库详情：上传 + 文件列表 -->
    <div class="detail-head">
      <button class="small" onclick={goBack}>← 返回列表</button>
      <h3 class="detail-title">{currentName}</h3>
      <button class="small danger" onclick={() => deleteCollection(selectedCollectionId)}>删除知识库</button>
    </div>

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
  {/if}
</section>

<style>
  .knowledge-card {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .knowledge-card > * {
    flex: 0 0 auto;
  }

  .knowledge-card .section,
  .knowledge-card .kb-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .create-bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .create-bar input {
    flex: 1;
    margin: 0;
    min-width: 0;
    padding: 0.45rem 0.6rem;
  }

  .kb-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .kb-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    transition: border-color 0.15s;
  }

  .kb-item:hover {
    border-color: var(--primary);
  }

  .kb-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    flex: 1;
  }

  .kb-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-count {
    font-size: 0.75rem;
    color: var(--muted);
    flex: 0 0 auto;
  }

  .kb-actions {
    display: flex;
    gap: 0.35rem;
    flex: 0 0 auto;
  }

  .detail-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
    flex-wrap: wrap;
  }

  .detail-title {
    margin: 0;
    flex: 1;
    font-size: 1.05rem;
  }

  .upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 1.5rem 1rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    text-align: center;
    color: var(--muted);
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    margin-bottom: 0.75rem;
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
    font-size: 1.4rem;
    line-height: 1;
  }

  .upload-title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .upload-hint {
    font-size: 0.78rem;
    opacity: 0.85;
  }

  .upload-tip {
    margin-top: -0.4rem;
    margin-bottom: 0.75rem;
    font-size: 0.78rem;
  }

  .file-progress {
    width: 100px;
    margin-bottom: 0.2rem;
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

  .file-table {
    font-size: 0.82rem;
  }

  .file-table th,
  .file-table td {
    padding: 0.4rem 0.5rem;
  }
</style>
