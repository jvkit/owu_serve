<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../lib/api';

  let { quota, email }: { quota: any; email: string } = $props();

  let name = $state('');
  let bio = $state('');
  let gender = $state('');
  let avatar = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let msg = $state('');
  let err = $state('');

  const displayName = $derived(quota?.user_name || email);
  const roleLabel = $derived(
    ({ admin: '管理员', user: '普通用户', pending: '待激活' } as Record<string, string>)[
      quota?.user_role || 'user'
    ] || '普通用户'
  );
  const planActive = $derived(quota?.plan?.status === 'active');

  onMount(async () => {
    try {
      const data = await apiGet('/api/user/profile');
      if (data.ok && data.profile) {
        name = data.profile.name || displayName;
        bio = data.profile.bio || '';
        gender = data.profile.gender || '';
        avatar = data.profile.profile_image_url || '';
      }
    } catch (e: any) {
      err = e.message;
    } finally {
      loading = false;
    }
  });

  function onAvatarPick(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      avatar = String(reader.result || '');
    };
    reader.readAsDataURL(f);
  }

  async function save() {
    saving = true;
    msg = '';
    err = '';
    try {
      await apiPost('/api/user/profile', {
        name: name.trim() || undefined,
        bio,
        gender: gender || undefined,
        profile_image_url: avatar || undefined,
      });
      msg = '资料已保存';
    } catch (e: any) {
      err = e.message;
    } finally {
      saving = false;
    }
  }
</script>

<section class="card profile-card">
  <h2>个人中心</h2>

  {#if loading}
    <p class="muted">加载中...</p>
  {:else}
    <div class="profile-top">
      <div class="avatar-wrap">
        {#if avatar}
          <img src={avatar} alt="头像" class="avatar" />
        {:else}
          <div class="avatar avatar-placeholder">{(displayName || '?').slice(0, 1).toUpperCase()}</div>
        {/if}
        <label class="avatar-upload">
          更换头像
          <input type="file" accept="image/*" onchange={onAvatarPick} hidden />
        </label>
      </div>
      <div class="profile-info">
        <label>
          用户名
          <input type="text" bind:value={name} />
        </label>
        <label>
          邮箱
          <input type="email" value={email} disabled />
        </label>
        <span class="role-badge">{roleLabel}</span>
      </div>
    </div>

    <div class="edit-grid">
      <label>
        性别
        <select bind:value={gender}>
          <option value="">未设置</option>
          <option value="male">男</option>
          <option value="female">女</option>
          <option value="other">其他</option>
        </select>
      </label>
      <label class="bio-field">
        个人简介
        <textarea rows="3" bind:value={bio} placeholder="介绍一下自己..."></textarea>
      </label>
    </div>

    <div class="plan-box">
      <span class="muted">套餐</span>
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
    </div>

    {#if err}<p class="error">{err}</p>{/if}
    {#if msg}<p class="ok">{msg}</p>{/if}
    <button class="save-btn" onclick={save} disabled={saving}>
      {saving ? '保存中...' : '保存资料'}
    </button>
  {/if}
</section>

<style>
  .profile-top {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .avatar-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--border);
  }

  .avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--muted);
    font-size: 1.6rem;
    font-weight: 600;
  }

  .avatar-upload {
    font-size: 0.75rem;
    color: var(--primary);
    cursor: pointer;
  }

  .profile-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .edit-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  .role-badge {
    align-self: flex-start;
    display: inline-block;
    font-size: 0.75rem;
    color: var(--muted);
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
  }

  .plan-box {
    border-top: 1px solid var(--border);
    padding-top: 0.8rem;
    margin-bottom: 0.8rem;
  }

  .plan-line {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.4rem 0;
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

  .save-btn {
    width: 100%;
  }

  .ok {
    color: #16a34a;
    font-size: 0.85rem;
    margin: 0.4rem 0;
  }
</style>
