<script lang="ts">
  import { apiGet } from './lib/api';
  import QuotaCard from './components/QuotaCard.svelte';
  import KnowledgePanel from './components/KnowledgePanel.svelte';

  let email = $state('');
  let token = $state('');
  let loading = $state(true);
  let error = $state('');
  let quota: any = $state(null);

  try {
    token = localStorage.getItem('gw_token') || '';
    email = localStorage.getItem('gw_email') || '';
  } catch (e) {
    console.error('localStorage error:', e);
  }

  async function loadQuota() {
    if (!email || !token) {
      loading = false;
      return;
    }
    try {
      quota = await apiGet('/api/user/quota');
    } catch (e: any) {
      error = e.message;
      if (e.message?.includes('登录') || e.message?.includes('过期')) {
        logout();
      }
    } finally {
      loading = false;
    }
  }

  function logout() {
    token = '';
    localStorage.removeItem('gw_token');
    localStorage.removeItem('gw_email');
    window.location.reload();
  }

  function goToChat() {
    window.location.href = '/';
  }

  $effect(() => {
    loadQuota();
  });
</script>

<main class="container">
  <header>
    <h1>用户中心</h1>
    <div class="header-actions">
      <button onclick={goToChat}>进入对话</button>
      <button onclick={logout}>退出</button>
    </div>
  </header>

  {#if loading}
    <p class="muted">加载中...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if quota}
    <section class="card">
      <h2>账号信息</h2>
      <p><strong>邮箱：</strong>{email}</p>
      <p><strong>角色：</strong>{quota.user?.role || 'user'}</p>
    </section>

    <QuotaCard {quota} />
    <KnowledgePanel />
  {/if}
</main>
