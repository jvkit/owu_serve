<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from './lib/api';
  import QuotaCard from './components/QuotaCard.svelte';
  import KnowledgePanel from './components/KnowledgePanel.svelte';

  onMount(() => {
    return setupOwuMessageListener();
  });

  const OWU_CHAT_URL = import.meta.env.VITE_OWU_CHAT_URL || '/';

  let email = $state('');
  let token = $state('');
  let loading = $state(true);
  let error = $state('');
  let quota: any = $state(null);

  // login form state
  let loginEmail = $state('');
  let loginPassword = $state('');
  let loginLoading = $state(false);
  let owuExchanging = $state(false);

  try {
    token = localStorage.getItem('gw_token') || '';
    email = localStorage.getItem('gw_email') || '';
  } catch (e) {
    console.error('localStorage error:', e);
  }

  async function exchangeOwuToken(owuToken: string) {
    if (token || owuExchanging) return;
    owuExchanging = true;
    error = '';
    try {
      const res = await fetch('/api/auth/owu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owu_token: owuToken }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'OWU 登录信息无效');

      token = data.token;
      email = data.user?.email || '';
      localStorage.setItem('gw_token', token);
      localStorage.setItem('gw_email', email);
    } catch (e: any) {
      error = e.message;
    } finally {
      owuExchanging = false;
    }
  }

  function setupOwuMessageListener() {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'OWU_TOKEN' && event.data.token) {
        exchangeOwuToken(event.data.token);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  async function loadQuota() {
    if (!email || !token) {
      loading = false;
      return;
    }
    loading = true;
    error = '';
    try {
      quota = await apiGet('/api/user/quota');
    } catch (e: any) {
      error = e.message;
      if (e.message?.includes('登录') || e.message?.includes('过期')) {
        logout(false);
      }
    } finally {
      loading = false;
    }
  }

  async function login(e: Event) {
    e.preventDefault();
    loginLoading = true;
    error = '';
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '登录失败');

      token = data.token;
      email = data.user?.email || loginEmail;
      localStorage.setItem('gw_token', token);
      localStorage.setItem('gw_email', email);
    } catch (e: any) {
      error = e.message;
    } finally {
      loginLoading = false;
    }
  }

  function logout(reload = true) {
    token = '';
    email = '';
    quota = null;
    localStorage.removeItem('gw_token');
    localStorage.removeItem('gw_email');
    if (reload) window.location.reload();
  }

  function goToChat() {
    window.location.href = OWU_CHAT_URL;
  }

  $effect(() => {
    loadQuota();
  });
</script>

<main class="container">
  <header>
    <h1>用户中心</h1>
    {#if token}
      <div class="header-actions">
        <button onclick={goToChat}>进入对话</button>
        <button onclick={() => logout()}>退出</button>
      </div>
    {/if}
  </header>

  {#if loading || owuExchanging}
    <p class="muted">{owuExchanging ? '正在通过 OWU 登录...' : '加载中...'}</p>
  {:else if !token}
    <section class="card login-card">
      <h2>登录</h2>
      {#if error}<p class="error">{error}</p>{/if}
      <form onsubmit={login}>
        <label>
          邮箱
          <input type="email" bind:value={loginEmail} required autocomplete="email" />
        </label>
        <label>
          密码
          <input type="password" bind:value={loginPassword} required autocomplete="current-password" />
        </label>
        <button type="submit" disabled={loginLoading}>
          {loginLoading ? '登录中...' : '登录'}
        </button>
      </form>
    </section>
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
