<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../lib/api';

  type PlanUser = {
    email: string;
    tier: number;
    status: 'active' | 'inactive';
    started_at: string;
    expires_at: string;
    next_tier?: number;
    next_expires_at?: string;
    extra_quota?: number;
    kb_purged_at?: string;
    storage_used: number;
    storage_quota: number;
    file_count_used: number;
    file_count_quota: number;
    chat_quota_remaining: number;
    chat_quota_used: number;
    chat_quota_total: number;
  };

  type InactiveUser = {
    email: string;
    tier: number;
    expired_at: string;
    storage_used: number;
    file_count_used: number;
    kb_purged_at?: string;
    days_until_purge: number;
  };

  const tierNames = ['', '等级一', '等级二', '等级三', '等级四', '等级五'];

  let email = $state('');
  let suggestions = $state<string[]>([]);
  let user = $state<PlanUser | null>(null);
  let inactiveUsers = $state<InactiveUser[]>([]);
  let loading = $state(false);
  let error = $state('');
  let message = $state('');
  let activeTab = $state<'user' | 'inactive'>('user');

  function fmtBytes(b: number) {
    const s = Number(b) || 0;
    if (!s) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(s) / Math.log(1024)), u.length - 1);
    return (s / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
  }

  function fmtDate(v?: string) {
    if (!v) return '-';
    const d = new Date(v.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('zh-CN');
  }

  async function onInput() {
    const q = email.trim().toLowerCase();
    if (q.length < 1) { suggestions = []; return; }
    try {
      const data = await apiGet('/api/admin/plans/search-suggest?q=' + encodeURIComponent(q));
      suggestions = data.emails || [];
    } catch { suggestions = []; }
  }

  async function search(selectedEmail?: string) {
    const q = (selectedEmail || email).trim().toLowerCase();
    if (!q) return;
    loading = true;
    error = '';
    message = '';
    suggestions = [];
    try {
      const data = await apiGet('/api/admin/plans/search?email=' + encodeURIComponent(q));
      if (!data.found) { user = null; error = '未找到该用户'; return; }
      user = data;
      email = data.email;
    } catch (e: any) {
      error = e.message;
      user = null;
    } finally {
      loading = false;
    }
  }

  async function call(action: string, body?: Record<string, any>) {
    if (!user) return;
    error = '';
    message = '';
    try {
      const data = await apiPost('/api/admin/plans/' + action, { email: user.email, ...body });
      message = data.message || '操作成功';
      await search(user.email);
    } catch (e: any) {
      error = e.message;
    }
  }

  async function loadInactive() {
    loading = true;
    error = '';
    try {
      const data = await apiGet('/api/admin/plans/inactive-list');
      inactiveUsers = data.users || [];
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function selectTier(options: number[], title: string, action: string, warning?: string) {
    if (!user) return;
    const chosen = window.prompt(title + '\n可选：' + options.map((o) => `${o} (${tierNames[o]})`).join('，'));
    if (!chosen) return;
    const t = Number(chosen);
    if (!options.includes(t)) { error = '无效选择'; return; }
    if (warning && !confirm(warning)) return;
    const body: any = { new_tier: t };
    if (action === 'assign') body.tier = t;
    call(action, body);
  }

  function renew() { call('renew'); }

  function upgrade() {
    if (!user) return;
    const options = [1, 2, 3, 4, 5].filter((t) => t > user!.tier);
    if (!options.length) { error = '已经是最高等级'; return; }
    selectTier(options, '选择升级目标等级', 'upgrade', '升级将立即生效，旧额度作废。');
  }

  function downgrade() {
    if (!user) return;
    if (user.next_tier != null) { error = '当前有待生效套餐，请等待生效后再降级'; return; }
    const options = [1, 2, 3, 4, 5].filter((t) => t < user!.tier);
    if (!options.length) { error = '已经是最低等级'; return; }
    selectTier(options, '选择降级目标等级（本周期结束后生效）', 'downgrade', '新周期开始时若知识库超限将被清空，请通知用户。');
  }

  function assign() {
    if (!user) return;
    const options = [1, 2, 3, 4, 5];
    selectTier(options, '选择要分配的套餐等级', 'assign', '分配将立即生效，旧额度作废。');
  }

  function topup() {
    if (!user) return;
    const amount = window.prompt('输入追加金额（元）：');
    if (!amount) return;
    const n = Number(amount);
    if (!n || n <= 0) { error = '金额无效'; return; }
    call('topup', { amount_usd: n });
  }

  onMount(() => {
    if (activeTab === 'inactive') loadInactive();
  });
</script>

<div class="panel">
  <div class="tabs">
    <button class:active={activeTab === 'user'} onclick={() => activeTab = 'user'}>用户管理</button>
    <button class:active={activeTab === 'inactive'} onclick={() => { activeTab = 'inactive'; loadInactive(); }}>过期用户列表</button>
  </div>

  {#if error}<p class="alert error">{error}</p>{/if}
  {#if message}<p class="alert success">{message}</p>{/if}

  {#if activeTab === 'user'}
    <div class="search-box">
      <div class="relative">
        <input
          type="text"
          placeholder="输入用户邮箱搜索..."
          bind:value={email}
          oninput={onInput}
          onkeydown={(e) => { if (e.key === 'Enter') search(); }}
        />
        {#if suggestions.length}
          <div class="suggest-list">
            {#each suggestions as s}
              <div class="suggest-item" onclick={() => { email = s; search(s); }}>{s}</div>
            {/each}
          </div>
        {/if}
      </div>
      <button class="btn primary" onclick={() => search()} disabled={loading}>
        {loading ? '搜索中...' : '搜索'}
      </button>
    </div>

    {#if user}
      <div class="user-card">
        <div class="flex-between">
          <div>
            <span class="email">{user.email}</span>
            <span class="badge" class:active={user.status === 'active'}>
              {user.status === 'active' ? '活跃' : '已过期'}
            </span>
          </div>
          <button class="btn small" onclick={() => search(user.email)} disabled={loading}>刷新</button>
        </div>
        <div class="muted mt-2">
          {tierNames[user.tier]} | {fmtDate(user.started_at)} ~ {fmtDate(user.expires_at)}
          {#if user.next_tier}
            <div class="mt-1">待生效：{tierNames[user.next_tier]}，{fmtDate(user.next_expires_at)}</div>
          {/if}
        </div>

        <div class="grid-3">
          <div><span class="muted">存储</span><br><b>{fmtBytes(user.storage_used)} / {fmtBytes(user.storage_quota)}</b></div>
          <div><span class="muted">文件</span><br><b>{user.file_count_used} / {user.file_count_quota} 个</b></div>
          <div><span class="muted">问答额度</span><br><b>¥{user.chat_quota_remaining.toFixed(2)} / ¥{user.chat_quota_total.toFixed(2)}</b></div>
        </div>

        <div class="actions-row">
          {#if user.status === 'active'}
            <button class="btn primary" onclick={renew}>续费</button>
            <button class="btn success" onclick={upgrade}>升级</button>
            <button class="btn warning" onclick={downgrade}>降级</button>
            <button class="btn purple" onclick={topup}>追加额度</button>
          {:else}
            <button class="btn primary" onclick={assign}>选套餐</button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="muted center mt-8">输入邮箱搜索用户</p>
    {/if}
  {:else}
    {#if inactiveUsers.length}
      <div class="user-list">
        {#each inactiveUsers as u}
          <div class="user-row">
            <div>
              <div class="font-medium">{u.email}</div>
              <div class="muted text-xs">
                {tierNames[u.tier]} | 过期 {fmtDate(u.expired_at)} | 知识库 {fmtBytes(u.storage_used)} {u.file_count_used}个文件
              </div>
            </div>
            <div class="flex items-center gap-3">
              <div class="text-right">
                <span class="text-lg font-bold text-red-600">{u.days_until_purge}</span>
                <span class="text-xs text-red-500">天后注销</span>
              </div>
              <button class="btn primary small" onclick={() => { email = u.email; activeTab = 'user'; search(u.email); }}>选套餐</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted center mt-8">暂无过期用户</p>
    {/if}
  {/if}
</div>

<style>
  .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 1.5rem; }
  .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
  .tabs button { padding: 0.5rem 1rem; border-radius: 0.5rem; border: none; background: transparent; cursor: pointer; font-size: 0.875rem; color: #6b7280; }
  .tabs button.active { background: #f3f4f6; color: #111827; font-weight: 500; }
  .search-box { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .search-box input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; }
  .relative { position: relative; flex: 1; }
  .suggest-list { position: absolute; left: 0; right: 0; top: 100%; margin-top: 0.25rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 0.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05); z-index: 10; max-height: 12rem; overflow-y: auto; }
  .suggest-item { padding: 0.5rem 0.75rem; font-size: 0.875rem; cursor: pointer; border-bottom: 1px solid #f3f4f6; }
  .suggest-item:last-child { border-bottom: none; }
  .suggest-item:hover { background: #eff6ff; }
  .user-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; }
  .flex-between { display: flex; justify-content: space-between; align-items: center; }
  .email { font-weight: 600; margin-right: 0.5rem; }
  .badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 700; background: #fee2e2; color: #b91c1c; }
  .badge.active { background: #dcfce7; color: #15803d; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 1rem 0; font-size: 0.875rem; }
  .actions-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .user-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .user-row { display: flex; justify-content: space-between; align-items: center; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.75rem 1rem; }
  .btn { padding: 0.5rem 0.75rem; border-radius: 0.5rem; border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; font-size: 0.875rem; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn.success { background: #16a34a; color: #fff; border-color: #16a34a; }
  .btn.warning { background: #ea580c; color: #fff; border-color: #ea580c; }
  .btn.purple { background: #9333ea; color: #fff; border-color: #9333ea; }
  .btn.small { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
  .alert { padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem; }
  .alert.error { background: #fee2e2; color: #b91c1c; }
  .alert.success { background: #dcfce7; color: #15803d; }
  .muted { color: #6b7280; }
  .center { text-align: center; }
  .mt-1 { margin-top: 0.25rem; }
  .mt-2 { margin-top: 0.5rem; }
  .mt-8 { margin-top: 2rem; }
  .text-xs { font-size: 0.75rem; }
  .text-lg { font-size: 1.125rem; }
  .text-right { text-align: right; }
  .font-bold { font-weight: 700; }
  .font-medium { font-weight: 500; }
  .text-red-600 { color: #dc2626; }
  .text-red-500 { color: #ef4444; }
  .items-center { align-items: center; }
  .gap-3 { gap: 0.75rem; }
  .flex { display: flex; }
</style>
