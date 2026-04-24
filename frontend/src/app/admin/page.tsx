"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  deleteUserById,
  fetchAllUsers,
  getUser,
  isAdmin,
  isLoggedIn,
  logout,
  updateUserRole,
  updateUserStatus,
} from "@/lib/auth";

interface UserItem {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: number;
  created_at: string;
  last_login: string | null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "操作失败，请稍后重试";
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const currentUser = getUser();

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetchAllUsers();
      setUsers(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }
    if (!isAdmin()) {
      router.push("/workspace/chats/new");
      return;
    }
    void loadUsers();
  }, [loadUsers, router]);

  const handleToggleStatus = async (user: UserItem) => {
    setActionLoading(user.id);
    try {
      await updateUserStatus(user.id, !user.is_active);
      await loadUsers();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleRole = async (user: UserItem) => {
    setActionLoading(user.id);
    try {
      const newRole = user.role === "admin" ? "user" : "admin";
      await updateUserRole(user.id, newRole);
      await loadUsers();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (user: UserItem) => {
    if (!confirm(`确定要删除用户 "${user.username}" 吗？此操作不可撤销。`))
      return;
    setActionLoading(user.id);
    try {
      await deleteUserById(user.id);
      await loadUsers();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* 顶部导航 */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🦌</span>
            <h1 className="text-lg font-semibold text-white">
              DeerFlow 管理后台
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/workspace/chats/new")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              返回工作台
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
                {currentUser?.username?.[0]?.toUpperCase()}
              </div>
              <span className="text-sm text-slate-300">
                {currentUser?.username}
              </span>
            </div>
            <button
              onClick={logout}
              className="rounded-lg bg-red-600/20 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-600/30"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* 统计卡片 */}
        <div className="mb-8 grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <p className="text-sm text-slate-400">总用户数</p>
            <p className="mt-1 text-3xl font-bold text-white">{users.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <p className="text-sm text-slate-400">管理员</p>
            <p className="mt-1 text-3xl font-bold text-blue-400">
              {users.filter((u) => u.role === "admin").length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <p className="text-sm text-slate-400">活跃用户</p>
            <p className="mt-1 text-3xl font-bold text-green-400">
              {users.filter((u) => u.is_active).length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <p className="text-sm text-slate-400">已禁用</p>
            <p className="mt-1 text-3xl font-bold text-red-400">
              {users.filter((u) => !u.is_active).length}
            </p>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              关闭
            </button>
          </div>
        )}

        {/* 用户表格 */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-800/30">
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  ID
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  用户名
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  邮箱
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  角色
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  状态
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  注册时间
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  最后登录
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="transition-colors hover:bg-slate-800/30"
                >
                  <td className="px-6 py-4 text-sm text-slate-300">
                    {user.id}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-white">
                        {user.username[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-white">
                        {user.username}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {user.email}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        user.role === "admin"
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-slate-500/20 text-slate-400"
                      }`}
                    >
                      {user.role === "admin" ? "管理员" : "普通用户"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        user.is_active
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${user.is_active ? "bg-green-400" : "bg-red-400"}`}
                      />
                      {user.is_active ? "活跃" : "已禁用"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString("zh-CN")
                      : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {user.last_login
                      ? new Date(user.last_login).toLocaleDateString("zh-CN")
                      : "从未"}
                  </td>
                  <td className="px-6 py-4">
                    {user.id !== currentUser?.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleRole(user)}
                          disabled={actionLoading === user.id}
                          className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
                        >
                          {user.role === "admin" ? "降为用户" : "升为管理"}
                        </button>
                        <button
                          onClick={() => handleToggleStatus(user)}
                          disabled={actionLoading === user.id}
                          className={`rounded-md px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                            user.is_active
                              ? "border border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                              : "border border-green-500/30 text-green-400 hover:bg-green-500/10"
                          }`}
                        >
                          {user.is_active ? "禁用" : "启用"}
                        </button>
                        <button
                          onClick={() => handleDelete(user)}
                          disabled={actionLoading === user.id}
                          className="rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">当前用户</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
