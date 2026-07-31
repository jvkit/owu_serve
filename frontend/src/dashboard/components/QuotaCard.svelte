<script lang="ts">
  import { formatBytes, formatUsd } from '$shared/format';

  let { quota }: { quota: any } = $props();

  function percent(used: number, total: number) {
    return total ? Math.min(100, (used / total) * 100) : 0;
  }
</script>

<section class="card">
  <h2>套餐额度</h2>
  {#if quota.plan}
    <div class="grid-2">
      <div>
        <p class="muted">当前等级</p>
        <p class="big">{quota.plan.tier}</p>
      </div>
      <div>
        <p class="muted">状态</p>
        <p class="big">{quota.plan.status === 'active' ? '生效中' : quota.plan.status}</p>
      </div>
      <div>
        <p class="muted">生效时间</p>
        <p>{quota.plan.started_at}</p>
      </div>
      <div>
        <p class="muted">到期时间</p>
        <p>{quota.plan.expires_at}</p>
      </div>
    </div>
  {:else}
    <p class="muted">暂无套餐</p>
  {/if}
</section>

<section class="card">
  <h2>对话额度</h2>
  <div class="metric">
    <div class="bar">
      <div class="bar-fill" style="width: {percent(quota.chat_quota_used_usd || 0, quota.chat_quota_total_usd || 0)}%"></div>
    </div>
    <p>
      已用 <strong>${formatUsd(quota.chat_quota_used_usd || 0)}</strong>
      / 剩余 <strong>${formatUsd(quota.chat_quota_remaining_usd || 0)}</strong>
      / 总额 <strong>${formatUsd(quota.chat_quota_total_usd || 0)}</strong>
      {#if quota.unlimited_quota}
        <span class="muted">（无限制）</span>
      {/if}
    </p>
  </div>
</section>

<section class="card">
  <h2>存储空间</h2>
  <div class="metric">
    <div class="bar">
      <div class="bar-fill" style="width: {percent(quota.storage_used || 0, quota.storage_quota || 0)}%"></div>
    </div>
    <p>
      已用 <strong>{formatBytes(quota.storage_used || 0)}</strong>
      / 总量 <strong>{formatBytes(quota.storage_quota || 0)}</strong>
    </p>
  </div>
  <div class="metric">
    <p>
      文件数 <strong>{quota.file_count_used || 0}</strong>
      / <strong>{quota.file_count_quota || 0}</strong>
    </p>
  </div>
</section>
