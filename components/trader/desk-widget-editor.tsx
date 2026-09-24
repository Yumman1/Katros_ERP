"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DESK_WIDGETS, restoreHiddenWidgets, widgetStorageKey, type DeskWidgetId } from "@/lib/trader-desk-widgets";

export function useDeskWidgets(commodityId?: string) {
  const { data: session } = useSession();
  const key = session?.user?.id && commodityId ? widgetStorageKey(session.user.id, commodityId) : "";
  const [saved, setSaved] = useState<{ key: string; hidden: DeskWidgetId[] }>({ key: "", hidden: [] });
  const [draft, setDraft] = useState<DeskWidgetId[]>([]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const hidden = saved.key === key ? saved.hidden : [];
  useEffect(() => {
    let restored: DeskWidgetId[] = [];
    try { const raw = key && localStorage.getItem(key); if (raw) restored = restoreHiddenWidgets(JSON.parse(raw)); } catch { /* An unavailable store must not hide the dashboard. */ }
    setSaved({ key, hidden: restored });
    setEditing(false);
    setNotice("");
  }, [key]);
  const isEditing = editing && saved.key === key;
  const visible = (id: DeskWidgetId) => !(isEditing ? draft : hidden).includes(id);
  const editor = <div className="space-y-3">
    <button type="button" className="kastros-btn-secondary" disabled={!key} onClick={() => { setDraft([...hidden]); setEditing(true); setNotice(""); }}>Edit widgets</button>
    {isEditing && <section aria-label="Edit dashboard widgets" className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Choose your widgets</h2>
      <p className="mt-1 text-xs text-subtle">Saved for your account and this commodity on this browser. Uncheck a widget to remove it; check it to add it back.</p>
      <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DESK_WIDGETS.map(widget => <label key={widget.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!draft.includes(widget.id)} onChange={e => setDraft(current => e.target.checked ? current.filter(id => id !== widget.id) : [...current, widget.id])} />{widget.label}</label>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="kastros-btn-primary" onClick={() => {
          setSaved({ key, hidden: draft }); setEditing(false);
          try { localStorage.setItem(key, JSON.stringify(draft)); setNotice("Widget choices saved."); }
          catch { setNotice("Applied for this visit. Browser storage is unavailable, so these choices cannot be saved after you leave."); }
        }}>Save widgets</button>
        <button type="button" className="kastros-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
        <button type="button" className="kastros-btn-secondary" onClick={() => setDraft([])}>Restore defaults</button>
      </div>
    </section>}
    {notice && <p role="status" className="text-xs text-subtle">{notice}</p>}
  </div>;
  return { visible, editor, empty: DESK_WIDGETS.every(w => !visible(w.id)) };
}
