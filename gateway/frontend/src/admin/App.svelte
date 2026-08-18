<script lang="ts">
  import { onMount } from 'svelte';
  import { apiPost, clearAdminToken, getAdminToken, setAdminToken } from './lib/api';
  import PlanTierPanel from './components/PlanTierPanel.svelte';
  import UserPlanPanel from './components/UserPlanPanel.svelte';

  let username = $state('');
  let password = $state('');
  let token = $state(getAdminToken());
  let error = $state('');
  let loading = $state(false);
  let owuExchanging = $state(false);
  let lastOwuToken = $state('');
  let tab = $state<'tiers' | 'users'>('tiers');

  async function exchangeOwuToken(owuToken: string) {
    if (!owuToken || owuToken === lastOwuToken || owuExchanging) return;
    owuExchanging = true;
    lastOwuToken = owuToken;
    error = '';
    let res: Response | null = null;
    try {
      res = await fetch('/api/admin/owu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owu_token: owuToken }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'OWU 登录信息无效');
      token = data.token;
      setAdminToken(token);
    } catch (e: any) {
      error = e.message;
      lastOwuToken = '';
      // 当前 OWU 用户不是管理员时，应清空旧管理员态
      if (res && res.status === 403) {
        logout();
      }
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

  onMount(() => {
    return setupOwuMessageListener();
  });

  async function login(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const res = await apiPost('/api/admin/login', { username, password });
      token = res.token;
      setAdminToken(token);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function logout(reload = true) {
    token = '';
    clearAdminToken();
    if (reload) window.location.reload();
  }
</script>

<main class="page">
  {#if token}
    <div class="wrapper">
      <header class="topbar">
        <h1>Gateway 管理后台</h1>
        <button class="logout" onclick={logout}>退出登录</button>
      </header>

      <div class="tabs">
        <button class="tab" class:active={tab === 'tiers'} onclick={() => tab = 'tiers'}>套餐档位</button>
        <button class="tab" class:active={tab === 'users'} onclick={() => tab = 'users'}>用户套餐</button>
      </div>

      {#if tab === 'tiers'}
        <PlanTierPanel />
      {:else}
        <UserPlanPanel />
      {/if}
    </div>
  {:else}
    <div class="login-card">
      <div class="login-header">
        <h1>管理员登录</h1>
        <p>套餐管理</p>
      </div>
      {#if owuExchanging}
        <p class="hint">正在通过 OWU 管理员身份登录...</p>
      {/if}
      <form onsubmit={login} class="login-form">
        <label>
          账号
          <input type="text" bind:value={username} required />
        </label>
        <label>
          密码
          <input type="password" bind:value={password} required />
        </label>
        {#if error}<p class="error">{error}</p>{/if}
        <button type="submit" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  {/if}
</main>

<style>
  .page {
    min-height: 100vh;
    background: #f9fafb;
    padding: 2rem 1rem;
  }
  .wrapper {
    max-width: 1100px;
    margin: 0 auto;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  .topbar h1 {
    margin: 0;
    font-size: 1.5rem;
    color: #111827;
  }
  .logout {
    padding: 0.5rem 1rem;
    background: #fff;
    color: #374151;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
  }
  .logout:hover {
    background: #f3f4f6;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.5rem;
  }
  .tab {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 0.875rem;
    color: #6b7280;
  }
  .tab.active {
    background: #f3f4f6;
    color: #111827;
    font-weight: 500;
  }
  .login-card {
    max-width: 360px;
    margin: 4rem auto;
    padding: 2rem;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 0.75rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .login-header {
    margin-bottom: 1.5rem;
  }
  .login-header h1 {
    margin: 0;
    font-size: 1.5rem;
    color: #111827;
  }
  .login-header p {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: #6b7280;
  }
  .hint {
    font-size: 0.875rem;
    color: #6b7280;
    margin-bottom: 1rem;
  }
  .login-form label {
    display: block;
    margin-bottom: 1rem;
    font-size: 0.875rem;
    color: #374151;
  }
  .login-form input {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    font-size: 1rem;
  }
  .login-form button {
    width: 100%;
    padding: 0.75rem;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .login-form button:hover {
    background: #1d4ed8;
  }
  .login-form button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    color: #dc2626;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }
</style>
