<script lang="ts">
  import { formatBytes, formatUsd } from '$shared/format';

  let { quota, email }: { quota: any; email: string } = $props();

  function percent(used: number, total: number) {
    return total ? Math.min(100, (used / total) * 100) : 0;
  }

  const planActive = $derived(quota?.plan?.status === 'active');
  const displayName = $derived(quota?.user_name || email);
  const roleLabel = $derived(
    ({ admin: '管理员', user: '普通用户', pending: '待激活' } as Record<string, string>)[
      quota?.user_role || 'user'
    ] || '普通用户'
  );
</script>

<!-- 账号信息 -->
<section class="card stat-card">
  <h2>账号信息</h2>
  <div class="kv">
    <div><span class="muted">用户名</span> {displayName}</div>
    <div><span class="muted">邮箱</span> {email}</div>
  </div>
  <span class="role-badge">{roleLabel}</span>
</section>

<!-- 套餐额度 -->
<section class="card stat-card">
  <h2>套餐额度</h2>
  {#if quota.plan}
    <div class="plan-line">
      <span class="plan-tier">T{quota.plan.tier}</span>
      <span class="plan-status" class:active={planActive}>
        {planActive ? '生效中' : quota.plan.status}
      </span>
    </div>
    <div class="plan-meta">
      <div><span class="muted">生效</span> {quota.plan.started_at}</div>
      <div><span class="muted">到期</span> {quota.plan.expires_at}</div>
    </div>
  {:else}
    <p class="muted">暂无套餐</p>
  {/if}
</section>

<!-- 对话额度 -->
<section class="card stat-card">
  <h2>对话额度</h2>
  <div class="quota-3">
    <div class="quota-item">
      <span class="quota-num">{formatUsd(quota.chat_quota_used_usd || 0)}</span>
      <span class="muted">已用</span>
    </div>
    <div class="quota-item">
      <span class="quota-num">{formatUsd(quota.chat_quota_remaining_usd || 0)}</span>
      <span class="muted">剩余</span>
    </div>
    <div class="quota-item">
      <span class="quota-num">{formatUsd(quota.chat_quota_total_usd || 0)}</span>
      <span class="muted">总额</span>
    </div>
  </div>
  <div class="bar">
    <div class="bar-fill" style="width: {percent(quota.chat_quota_used_usd || 0, quota.chat_quota_total_usd || 0)}%"></div>
  </div>
  <p class="muted tiny">
    {#if quota.unlimited_quota}
      无限制
    {:else}
      已用 {Math.round(percent(quota.chat_quota_used_usd || 0, quota.chat_quota_total_usd || 0))}%
    {/if}
  </p>
</section>

<!-- 存储空间 -->
<section class="card stat-card">
  <h2>存储空间</h2>
  <div class="quota-3">
    <div class="quota-item">
      <span class="quota-num">{formatBytes(quota.storage_used || 0)}</span>
      <span class="muted">已用</span>
    </div>
    <div class="quota-item">
      <span class="quota-num">{formatBytes(Math.max(0, (quota.storage_quota || 0) - (quota.storage_used || 0)))}</span>
      <span class="muted">剩余</span>
    </div>
    <div class="quota-item">
      <span class="quota-num">{formatBytes(quota.storage_quota || 0)}</span>
      <span class="muted">总量</span>
    </div>
  </div>
  <div class="bar">
    <div class="bar-fill" style="width: {percent(quota.storage_used || 0, quota.storage_quota || 0)}%"></div>
  </div>
  <p class="muted tiny">文件 {quota.file_count_used || 0} / {quota.file_count_quota || 0}</p>
</section>

<style>
  .kv {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
    font-size: 0.9rem;
    word-break: break-all;
  }

  .kv .muted {
    display: inline-block;
    min-width: 3.5em;
  }

  .role-badge {
    display: inline-block;
    font-size: 0.75rem;
    color: var(--muted);
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
  }

  .quota-3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0.25rem 0 0.5rem;
  }

  .quota-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }

  .quota-num {
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .plan-line {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }

  .plan-tier {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1;
  }

  .plan-status {
    font-size: 0.75rem;
    color: var(--muted);
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
  }

  .plan-status.active {
    color: #15803d;
    background: #f0fdf4;
    border-color: #bbf7d0;
  }

  .plan-meta {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }

  .tiny {
    font-size: 0.78rem;
  }
</style>
