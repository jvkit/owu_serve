<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';

  type Tier = {
    id: number;
    name: string;
    storage_gb: number;
    file_count: number;
    chat_quota_usd: number;
    is_active: number;
  };

  let tiers: Tier[] = $state([]);
  let loading = $state(false);
  let error = $state('');
  let message = $state('');

  let editing = $state<Partial<Tier> | null>(null);
  let showModal = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const data = await apiGet('/api/admin/plan-tiers');
      tiers = data.tiers || [];
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editing = { id: 0, name: '', storage_gb: 1, file_count: 100, chat_quota_usd: 5, is_active: 1 };
    showModal = true;
  }

  function openEdit(t: Tier) {
    editing = { ...t };
    showModal = true;
  }

  async function save() {
    if (!editing) return;
    error = '';
    message = '';
    try {
      if (!editing.id || editing.id < 1) throw new Error('请输入有效档位编号');
      if (!editing.name?.trim()) throw new Error('请输入名称');
      const payload = {
        id: Number(editing.id),
        name: editing.name.trim(),
        storage_gb: Number(editing.storage_gb),
        file_count: Number(editing.file_count),
        chat_quota_usd: Number(editing.chat_quota_usd),
      };
      const exists = tiers.find((t) => t.id === payload.id);
      if (exists) {
        await apiPut(`/api/admin/plan-tiers/${payload.id}`, payload);
        message = '套餐档位已更新';
      } else {
        await apiPost('/api/admin/plan-tiers', payload);
        message = '套餐档位已创建';
      }
      showModal = false;
      await load();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function remove(t: Tier) {
    if (!confirm(`确定删除「${t.name}」？若该档位仍有用户使用将无法删除。`)) return;
    error = '';
    message = '';
    try {
      await apiDelete(`/api/admin/plan-tiers/${t.id}`);
      message = '套餐档位已删除';
      await load();
    } catch (e: any) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="panel">
  <div class="header">
    <h2>套餐档位管理</h2>
    <button class="btn primary" onclick={openCreate}>+ 新增档位</button>
  </div>

  {#if error}<p class="alert error">{error}</p>{/if}
  {#if message}<p class="alert success">{message}</p>{/if}

  {#if loading && tiers.length === 0}
    <p class="muted">加载中...</p>
  {:else}
    <table class="tier-table">
      <thead>
        <tr>
          <th>档位</th>
          <th>名称</th>
          <th>存储空间</th>
          <th>文件数</th>
          <th>对话额度</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {#each tiers as t (t.id)}
          <tr class:inactive={!t.is_active}>
            <td>{t.id}</td>
            <td>{t.name}</td>
            <td>{t.storage_gb} GB</td>
            <td>{t.file_count}</td>
            <td>¥{t.chat_quota_usd.toFixed(2)}</td>
            <td>{t.is_active ? '启用' : '停用'}</td>
            <td class="actions">
              <button class="btn small" onclick={() => openEdit(t)}>编辑</button>
              <button class="btn small danger" onclick={() => remove(t)}>删除</button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="muted center">暂无套餐档位</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if showModal && editing}
  <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) showModal = false; }}>
    <div class="modal">
      <h3>{tiers.find((t) => t.id === editing?.id) ? '编辑档位' : '新增档位'}</h3>
      <label>
        档位编号
        <input type="number" min="1" bind:value={editing.id} disabled={tiers.find((t) => t.id === editing?.id) !== undefined} />
      </label>
      <label>
        名称
        <input type="text" bind:value={editing.name} />
      </label>
      <label>
        存储空间（GB）
        <input type="number" min="0" bind:value={editing.storage_gb} />
      </label>
      <label>
        文件数上限
        <input type="number" min="0" bind:value={editing.file_count} />
      </label>
      <label>
        对话额度（USD）
        <input type="number" min="0" step="0.01" bind:value={editing.chat_quota_usd} />
      </label>
      <div class="modal-actions">
        <button class="btn" onclick={() => showModal = false}>取消</button>
        <button class="btn primary" onclick={save}>保存</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .panel {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 0.75rem;
    padding: 1.5rem;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .header h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .tier-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .tier-table th, .tier-table td {
    text-align: left;
    padding: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .tier-table th {
    color: #6b7280;
    font-weight: 500;
  }
  .tier-table tr.inactive td {
    color: #9ca3af;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .btn {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    cursor: pointer;
    font-size: 0.875rem;
  }
  .btn.primary {
    background: #2563eb;
    color: #fff;
    border-color: #2563eb;
  }
  .btn.danger {
    color: #dc2626;
    border-color: #fecaca;
  }
  .btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }
  .alert {
    padding: 0.75rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }
  .alert.error {
    background: #fee2e2;
    color: #b91c1c;
  }
  .alert.success {
    background: #dcfce7;
    color: #15803d;
  }
  .muted {
    color: #9ca3af;
  }
  .center {
    text-align: center;
  }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .modal {
    background: #fff;
    border-radius: 0.75rem;
    padding: 1.5rem;
    width: 24rem;
    max-width: 90vw;
  }
  .modal h3 {
    margin-bottom: 1rem;
    font-size: 1.125rem;
    font-weight: 600;
  }
  .modal label {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    color: #374151;
  }
  .modal input {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
