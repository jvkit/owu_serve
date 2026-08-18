<script lang="ts">
  import { formatBytes, formatUsd } from '$shared/format';

  let { quota, type }: { quota: any; type: 'chat' | 'storage' } = $props();

  function percent(used: number, total: number) {
    return total ? Math.min(100, (used / total) * 100) : 0;
  }

  const isChat = $derived(type === 'chat');
  const title = $derived(isChat ? '对话额度' : '存储空间');
  const fmt = $derived(isChat ? formatUsd : formatBytes);

  const used = $derived(isChat ? quota.chat_quota_used_usd || 0 : quota.storage_used || 0);
  const total = $derived(isChat ? quota.chat_quota_total_usd || 0 : quota.storage_quota || 0);
  const remaining = $derived(Math.max(0, total - used));
  const pct = $derived(percent(used, total));

  const footer = $derived(
    isChat
      ? quota.unlimited_quota
        ? '无限制'
        : `已用 ${Math.round(pct)}%`
      : `文件 ${quota.file_count_used || 0} / ${quota.file_count_quota || 0}`
  );
</script>

<section class="card stat-card">
  <h2>{title}</h2>
  <div class="quota-3">
    <div class="quota-item">
      <span class="quota-num">{fmt(used)}</span>
      <span class="muted">已用</span>
    </div>
    <div class="quota-item">
      <span class="quota-num">{fmt(remaining)}</span>
      <span class="muted">剩余</span>
    </div>
    <div class="quota-item">
      <span class="quota-num">{fmt(total)}</span>
      <span class="muted">总额</span>
    </div>
  </div>
  <div class="bar">
    <div class="bar-fill" style="width: {pct}%"></div>
  </div>
  <p class="muted tiny">{footer}</p>
</section>

<style>
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

  .tiny {
    font-size: 0.78rem;
  }
</style>
