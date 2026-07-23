import { config } from '../config';
import { logger } from './logger';

export async function getAdminHeader(): Promise<Record<string, string>> {
    if (!config.newApiAdminAccessToken) {
        throw new Error(`
❌ [环境配置缺失 / Missing Root Token]：
2026 最新版 NewAPI 增加了极强的反自动化安全校验，不再允许底层使用账号密码 (Cookie) 自动生成 Token。
系统检测到它强制要求携带 \`New-Api-User\` 并配合 Admin Token 才能调用发卡/创建 Token 接口。

👉 【最终解决方案】：
1. 请前往您的 NewAPI 管理面板，以 root 用户登录。
2. 找到"令牌" (Tokens) 页面，手动添加一个【无限额度】的管理员 Token。
3. 复制生成的 \`sk-xxxxxxxx\` 密钥。
4. 返回此项目的环境变量设置 / \`.env\` 文件，增加配置：
   NEWAPI_ADMIN_ACCESS_TOKEN=您的密钥

配置完成后重新部署即可完美运行！`);
    }

    return {
        'Authorization': `Bearer ${config.newApiAdminAccessToken}`,
        'New-Api-User': '1',
        'Content-Type': 'application/json',
    };
}

export interface NewApiResponse {
    status: number;
    data: any;
}

export async function callNewApi(method: string, endpoint: string, bodyObj?: any): Promise<NewApiResponse> {
    const headers = await getAdminHeader();
    const res = await fetch(`${config.newApiBaseUrl}${endpoint}`, {
        method,
        headers,
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });

    const responseText = await res.text();
    let data: any = {};
    if (responseText) {
        try {
            data = JSON.parse(responseText);
        } catch {
            data = { message: responseText };
        }
    }

    if (res.status === 401) {
        throw new Error(`
❌ [Token 权限遭拒 / Invalid Admin Token]：
您的 NEWAPI_ADMIN_ACCESS_TOKEN 校验失败（${responseText}）。
👉 解决方案：您设置的 Admin Token 可能已过期、被禁用或复制错误，请前往 NewAPI 重新生成管理员 Token 并在环境变量中更新。`);
    }
    return { status: res.status, data };
}

export async function callNewApiRaw(method: string, endpoint: string, bodyObj?: any, extraHeaders?: Record<string, string>): Promise<Response> {
    const headers = await getAdminHeader();
    return fetch(`${config.newApiBaseUrl}${endpoint}`, {
        method,
        headers: { ...headers, ...extraHeaders },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
}
