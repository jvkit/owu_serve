<script lang="ts">
  let username = $state('');
  let password = $state('');
  let token = $state('');
  let error = $state('');
  let loading = $state(false);

  try {
    token = localStorage.getItem('gw_admin_token') || '';
  } catch (e) {
    console.error('localStorage error:', e);
  }

  async function login(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '登录失败');
      token = data.token;
      localStorage.setItem('gw_admin_token', token);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function logout() {
    token = '';
    localStorage.removeItem('gw_admin_token');
  }
</script>

<main class="container">
  {#if token}
    <header>
      <h1>管理后台</h1>
      <button onclick={logout}>退出</button>
    </header>
    <p>Admin 重构中，后续这里会显示用户搜索、套餐管理、过期用户列表。</p>
  {:else}
    <form onsubmit={login}>
      <h1>管理员登录</h1>
      {#if error}<p class="error">{error}</p>{/if}
      <label>
        账号
        <input type="text" bind:value={username} required />
      </label>
      <label>
        密码
        <input type="password" bind:value={password} required />
      </label>
      <button type="submit" disabled={loading}>
        {loading ? '登录中...' : '登录'}
      </button>
    </form>
  {/if}
</main>
