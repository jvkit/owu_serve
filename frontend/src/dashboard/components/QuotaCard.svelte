<script lang="ts">
  import { formatBytes, formatUsd } from '$shared/format';

  let { quota, email }: { quota: any; email: string } = $props();

  function percent(used: number, total: number) {
    return total ? Math.min(100, (used / total) * 100) : 0;
  }

  const planActive = $derived(quota?.plan?.status === 'active');
</script>

<!-- 账号信息 -->
<section class="card stat-card">
  <h2>账号信息</h2>
  <p class="account-email" title={email}>{email}</p>
  <span class="role-badge">{quota.user?.role || 'user'}</span>
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
  <div class="big">{formatUsd(quota.chat_quota_used_usd || 0)}</div>
  <div class="bar">
    <div class="bar-fill" style="width: {percent(quota.chat_quota_used_usd || 0, quota.chat_quota_total_usd || 0)}%"></div>
  </div>
  <p class="muted">
    剩余 <strong>{formatUsd(quota.chat_quota_remaining_usd || 0)}</strong>
    {#if quota.unlimited_quota}<span>（无限制）</span>{/if}
  </p>
  <p class="muted tiny">总额 {formatUsd(quota.chat_quota_total_usd || 0)}</p>
</section>

<!-- 存储空间 -->
<section class="card stat-card">
  <h2>存储空间</h2>
  <div class="big">{formatBytes(quota.storage_used || 0)}</div>
  <div class="bar">
    <div class="bar-fill" style="width: {percent(quota.storage_used || 0, quota.storage_quota || 0)}%"></div>
  </div>
  <p class="muted">
    总量 <strong>{formatBytes(quota.storage_quota || 0)}</strong> · 文件 <strong>{quota.file_count_used || 0}</strong>/{quota.file_count_quota || 0}
  </p>
</section>

<style>
  .account-email {
    margin: 0 0 0.5rem 0;
    font-size: 0.95rem;
    font-weight: 600;
    word-break: break-all;
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
