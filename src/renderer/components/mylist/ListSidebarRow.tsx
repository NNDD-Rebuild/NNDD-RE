import { ICON_PRESET_GROUPS } from './mylistUtils';

/** アイコン選択ポップオーバー (背面クリックで閉じる) */
function IconPickerPopover({
  resetLabel,
  onClose,
  onSelect
}: {
  resetLabel: string;
  onClose: () => void;
  onSelect: (icon: string | null) => void;
}): JSX.Element {
  return (
    <>
      <div
        className="fixed inset-0 z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div
        className="absolute left-0 top-full z-20 mt-1 p-2 bg-nndd-bg border border-nndd-border rounded shadow-lg w-max"
        onClick={(e) => e.stopPropagation()}
      >
        {ICON_PRESET_GROUPS.map((group) => (
          <div key={group.label} className="mb-1.5 last:mb-0">
            <div className="text-[10px] text-nndd-subtext mb-0.5">{group.label}</div>
            <div className="grid grid-cols-8 gap-0.5">
              {group.icons.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => onSelect(emoji)}
                  className="text-base p-1 hover:bg-nndd-border rounded"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          onClick={() => onSelect(null)}
          className="w-full text-[10px] text-nndd-subtext hover:text-nndd-accent mt-1 pt-1 border-t border-nndd-border"
        >
          {resetLabel}
        </button>
      </div>
    </>
  );
}

/**
 * 左ペインのリスト 1 行 (マイリスト / プレイリスト共用)。
 * クリックで選択、右クリックで名前編集、アイコンクリックでアイコン選択、× で削除。
 */
export function ListSidebarRow({
  icon,
  name,
  title,
  iconResetLabel,
  isSelected,
  isEditing,
  editingName,
  iconPickerOpen,
  onSelect,
  onStartEdit,
  onEditingNameChange,
  onCommitRename,
  onCancelEdit,
  onToggleIconPicker,
  onCloseIconPicker,
  onIconChange,
  onRemove,
  depth = 0,
  folder,
  drag
}: {
  icon: string;
  name: string;
  title: string;
  iconResetLabel: string;
  isSelected: boolean;
  isEditing: boolean;
  editingName: string;
  iconPickerOpen: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onEditingNameChange: (name: string) => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
  onToggleIconPicker: () => void;
  onCloseIconPicker: () => void;
  onIconChange: (icon: string | null) => void;
  onRemove: () => void;
  /** フォルダ内の階層の深さ (インデント用) */
  depth?: number;
  /** フォルダ行のとき指定。展開状態と開閉コールバック */
  folder?: { expanded: boolean; onToggle: () => void };
  /** ドラッグ&ドロップによるフォルダ移動 */
  drag?: {
    onDragStart: () => void;
    onDragEnd: () => void;
    /** ドロップ先になれる行 (フォルダ) のみ指定 */
    onDrop?: () => void;
  };
}): JSX.Element {
  return (
    <div
      className={[
        'relative flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border cursor-pointer',
        isSelected ? 'bg-nndd-bg' : 'hover:bg-nndd-border'
      ].join(' ')}
      style={depth > 0 ? { paddingLeft: 8 + depth * 14 } : undefined}
      draggable={drag !== undefined && !isEditing}
      onDragStart={drag ? (e) => { e.dataTransfer.effectAllowed = 'move'; drag.onDragStart(); } : undefined}
      onDragEnd={drag?.onDragEnd}
      onDragOver={drag?.onDrop ? (e) => e.preventDefault() : undefined}
      onDrop={drag?.onDrop ? (e) => { e.preventDefault(); e.stopPropagation(); drag.onDrop?.(); } : undefined}
      onClick={() => {
        if (isEditing) return;
        if (folder) folder.onToggle();
        else onSelect();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onStartEdit();
      }}
    >
      {folder && (
        <span className="shrink-0 w-3 text-nndd-subtext">{folder.expanded ? '▼' : '▶'}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleIconPicker();
        }}
        className="text-nndd-subtext shrink-0 hover:opacity-70"
        title="アイコンを変更"
      >
        {icon}
      </button>
      {iconPickerOpen && (
        <IconPickerPopover
          resetLabel={iconResetLabel}
          onClose={onCloseIconPicker}
          onSelect={onIconChange}
        />
      )}
      {isEditing ? (
        <input
          autoFocus
          value={editingName}
          onChange={(e) => onEditingNameChange(e.target.value)}
          onBlur={() => onCommitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename();
            if (e.key === 'Escape') onCancelEdit();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-nndd-bg border border-nndd-accent px-1 py-0 text-xs outline-none"
        />
      ) : (
        <span className="flex-1 truncate" title={title}>{name}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="text-nndd-subtext hover:text-red-500 dark:hover:text-red-400"
        title="削除"
      >
        ×
      </button>
    </div>
  );
}
