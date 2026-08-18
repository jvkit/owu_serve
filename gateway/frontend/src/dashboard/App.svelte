<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from './lib/api';
  import UsageCard from './components/UsageCard.svelte';
  import ProfileCard from './components/ProfileCard.svelte';
  import KnowledgePanel from './components/KnowledgePanel.svelte';

  onMount(() => {
    // 独立打开时（非 iframe）直接显示登录表单，不等待 OWU token
    const inIframe = window.parent !== window;
    if (!inIframe) {
      loading = false;
      return;
    }
    return setupOwuMessageListener();
  });

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
  let lastOwuToken = $state('');

  try {
    token = localStorage.getItem('gw_token') || '';
    email = localStorage.getItem('gw_email') || '';
  } catch (e) {
    console.error('localStorage error:', e);
  }

  async function exchangeOwuToken(owuToken: string) {
    if (!owuToken || owuToken === lastOwuToken || owuExchanging) return;
    owuExchanging = true;
    lastOwuToken = owuToken;
    error = '';
    try {
      const res = await fetch('/api/auth/owu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owu_token: owuToken }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'OWU 登录信息无效');

      const newEmail = data.user?.email || '';
      const switched = newEmail && newEmail !== email;
      token = data.token;
      email = newEmail;
      localStorage.setItem('gw_token', token);
      localStorage.setItem('gw_email', email);
      // 如果切换了账号，刷新页面以清空组件内的旧状态
      if (switched) {
        window.location.reload();
      }
    } catch (e: any) {
      error = e.message;
      lastOwuToken = '';
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

    // 主动向父页面请求当前 OWU token，确保账号切换后能重新鉴权
    try {
      window.parent.postMessage({ type: 'OWU_TOKEN_REQUEST' }, '*');
    } catch {
      // ignore
    }

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

  $effect(() => {
    loadQuota();
  });
</script>

<main class="container">
  <header>
    <div class="brand">
      <h1>PRIME AI 用户中心</h1>
    </div>
  </header>

  {#if loading || (owuExchanging && window.parent !== window)}
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
    <div class="dashboard-grid">
      <aside class="sidebar">
        <ProfileCard {quota} {email} />
      </aside>
      <div class="main-content">
        <div class="usage-row">
          <UsageCard {quota} type="chat" />
          <UsageCard {quota} type="storage" />
        </div>
        <KnowledgePanel />
      </div>
    </div>
  {/if}
</main>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .brand h1 {
    font-size: 1.25rem;
    margin: 0;
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1rem;
    align-items: stretch;
    height: calc(100vh - 80px);
    min-height: 0;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .usage-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
    flex: 0 0 auto;
  }

  @media (max-width: 900px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .usage-row {
      grid-template-columns: 1fr;
    }
  }
</style>
