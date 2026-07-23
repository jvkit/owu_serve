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

  async function loadFiles() {
    if (!selectedCollectionId) return;
    loading = true;
    try {
      const data = await apiGet('/api/files/list', { collectionId: selectedCollectionId });
      files = data.files || [];
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
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
    const file = input.files?.[0];
    if (!file || !selectedCollectionId) return;
    await uploadFile(file);
    input.value = '';
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
      await loadFiles();
      uploadProgress = `${file.name} 上传成功`;
      setTimeout(() => uploadProgress = '', 2000);
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
      await loadFiles();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function rebuildFile(id: string) {
    try {
      await apiPost(`/api/files/${id}/rebuild`);
      await loadFiles();
    } catch (e: any) {
      error = e.message;
    }
  }

  function statusLabel(status: string) {
    const map: Record<string, string> = {
      queued: '等待上传', uploading: '上传中', uploaded: '等待解析', parsing: '解析中',
      parse_failed: '解析失败', parsed: '已解析', build_queued: '等待构建',
      build_pending: '构建中', build_failed: '构建失败', build_done: '已完成'
    };
    return map[status] || status;
  }

  $effect(() => {
    loadCollections();
  });

  $effect(() => {
    loadFiles();
  });
</script>

<section class="card">
  <h2>文件与知识库</h2>

  {#if error}<p class="error">{error}</p>{/if}

  <div class="section">
    <h3>知识库</h3>
    <div class="flex-row">
      <select bind:value={selectedCollectionId}>
        {#each collections as c}
          <option value={c.id}>{c.name}{c.isDefault ? '（默认）' : ''}</option>
        {/each}
      </select>
      <button class="danger" onclick={() => deleteCollection(selectedCollectionId)} disabled={!selectedCollectionId}>
        删除
      </button>
    </div>
    <div class="flex-row mt-1">
      <input type="text" placeholder="新建知识库名称" bind:value={newCollectionName} />
      <button onclick={createCollection}>创建</button>
    </div>
  </div>

  <div class="section">
    <h3>上传文件</h3>
    <label class="upload-area">
      <input type="file" onchange={handleFileUpload} />
      <span>点击选择文件 或拖拽到此处</span>
    </label>
    {#if uploadProgress}<p class="muted">{uploadProgress}</p>{/if}
  </div>

  <div class="section">
    <h3>文件列表</h3>
    {#if loading}
      <p class="muted">加载中...</p>
    {:else if files.length === 0}
      <p class="muted">暂无文件</p>
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
            <tr>
              <td>{f.name}</td>
              <td>{formatBytes(f.size || 0)}</td>
              <td>{statusLabel(f.status)} {f.progress ? `(${f.progress}%)` : ''}</td>
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
