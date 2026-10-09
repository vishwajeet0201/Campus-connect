"use client";

import { ArrowLeft, Copy, MoreHorizontal, Reply, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { GlassBar, GlassButton } from "@/components/glass";
import { formatChatDate, shouldShowTimestamp, validateMessageBody, type ChatMessage } from "@/lib/chat";

type Member = { user_id: string; last_read_at: string | null; muted: boolean; profile: { full_name: string | null; username: string | null } | null };

export function ConversationView({ conversationId }: { conversationId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const oldestRef = useRef<string | null>(null);

  const markRead = useCallback(async () => {
    if (!userId) return;
    await supabase.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", conversationId).eq("user_id", userId);
  }, [conversationId, supabase, userId]);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: messageRows }, { data: members }] = await Promise.all([
        supabase.from("messages").select("id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,reply_to").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(30),
        supabase.from("conversation_members").select("user_id,last_read_at,muted,profile:profiles(full_name,username)").eq("conversation_id", conversationId),
      ]);
      if (!active) return;
      setUserId(user.id);
      const ordered = ((messageRows ?? []) as ChatMessage[]).reverse();
      oldestRef.current = ordered[0]?.created_at ?? null;
      setMessages(ordered);
      setMember(((members ?? []).find((item) => item.user_id !== user.id) ?? null) as Member | null);
      void markRead();
    }
    void load();
    const channel = supabase.channel(`conversation-${conversationId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const incoming = payload.new as ChatMessage;
      setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
      void markRead();
    }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [conversationId, markRead, supabase]);

  const loadOlder = async () => {
    if (olderLoading || !oldestRef.current) return;
    setOlderLoading(true);
    const beforeHeight = listRef.current?.scrollHeight ?? 0;
    const { data } = await supabase.from("messages").select("id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,reply_to").eq("conversation_id", conversationId).lt("created_at", oldestRef.current).order("created_at", { ascending: false }).limit(30);
    const older = ((data ?? []) as ChatMessage[]).reverse();
    oldestRef.current = older[0]?.created_at ?? oldestRef.current;
    setMessages((current) => [...older, ...current]);
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop += listRef.current.scrollHeight - beforeHeight; });
    setOlderLoading(false);
  };

  const send = async () => {
    const result = validateMessageBody(body);
    if (!result.valid || !result.value || !userId) { setError(result.message ?? "Sign in to send messages."); return; }
    setError("");
    const optimistic: ChatMessage = { id: `optimistic-${Date.now()}`, conversation_id: conversationId, sender_id: userId, body: result.value, created_at: new Date().toISOString(), status: "sending" };
    setMessages((current) => [...current, optimistic]);
    setBody("");
    const { data, error: sendError } = await supabase.from("messages").insert({ conversation_id: conversationId, sender_id: userId, body: result.value }).select("id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,reply_to").single();
    if (sendError || !data) {
      setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...message, status: "failed" } : message));
      setError(sendError?.message ?? "Message failed to send.");
      return;
    }
    setMessages((current) => current.map((message) => message.id === optimistic.id ? data as ChatMessage : message));
  };

  const handleInput = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  };

  const deleteMessage = async (id: string) => {
    await supabase.from("messages").update({ deleted_at: new Date().toISOString(), body: "Message deleted" }).eq("id", id).eq("sender_id", userId);
    setMessages((current) => current.map((message) => message.id === id ? { ...message, deleted_at: new Date().toISOString(), body: "Message deleted" } : message));
    setMenuId(null);
  };

  const otherName = member?.profile?.full_name ?? member?.profile?.username ?? "Conversation";
  return (
    <main className="conversation-page app-background">
      <header className="conversation-header"><button type="button" onClick={() => router.push("/chat")} aria-label="Back to chats"><ArrowLeft /></button><button type="button" className="conversation-person"><span className="chat-avatar">{otherName.slice(0, 1).toUpperCase()}</span><span>{otherName}</span></button><button type="button" aria-label="Conversation menu"><MoreHorizontal /></button></header>
      <div className="message-list" ref={listRef} onScroll={(event) => { if (event.currentTarget.scrollTop < 80) void loadOlder(); }} onFocus={() => void markRead()}>
        {olderLoading && <p className="message-loading">Loading older messages…</p>}
        {messages.map((message, index) => {
          const outgoing = message.sender_id === userId;
          const lastOfGroup = index === messages.length - 1 || messages[index + 1].sender_id !== message.sender_id;
          return <div className={`message-group ${outgoing ? "outgoing" : "incoming"}`} key={message.id}>{shouldShowTimestamp(messages, index) && <time className="message-date">{formatChatDate(message.created_at)}</time>}<div className="message-line"><button type="button" className={`message-bubble ${lastOfGroup ? "message-tail" : ""} ${message.status === "failed" ? "message-failed" : ""}`} onContextMenu={(event) => { event.preventDefault(); setMenuId(message.id); }} onClick={() => setMenuId(message.id)}>{message.deleted_at ? <em>{message.body}</em> : message.body}</button>{message.status === "sending" && <small>Sending…</small>}{message.status === "failed" && <button type="button" className="retry-message" onClick={() => setBody(message.body)}>Retry</button>}</div>{menuId === message.id && <div className="message-menu"><button type="button" onClick={() => void navigator.clipboard.writeText(message.body)}><Copy /> Copy</button><button type="button" onClick={() => setBody(`> ${message.body}\n`)}><Reply /> Reply</button>{outgoing && <button type="button" onClick={() => void deleteMessage(message.id)}><Trash2 /> Delete for me</button>}</div>}</div>;
        })}
        {messages.length === 0 && <div className="chat-empty"><p>No messages yet. Say hello.</p></div>}
      </div>
      {error && <p className="conversation-error" role="alert">{error}</p>}
      <GlassBar className="message-input-bar"><textarea ref={textareaRef} rows={1} value={body} maxLength={4000} placeholder="Message" onChange={(event) => setBody(event.target.value)} onKeyDown={handleInput} /><GlassButton surface="glass" variant="primary" className="send-button grid h-10 w-10 place-items-center rounded-full" aria-label="Send message" disabled={!body.trim()} onClick={() => void send()}><Send className="h-4 w-4" /></GlassButton></GlassBar>
    </main>
  );
}
