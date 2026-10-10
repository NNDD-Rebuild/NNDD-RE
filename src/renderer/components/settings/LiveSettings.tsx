import { useConfig } from '@renderer/hooks/useConfig';
import { CheckRow, Hint, NumberCommitInput, PageTitle, RadioGroup, Row, Section, SettingsPage } from './common';

/** 設定 > 生放送 */
export function LiveSettings(): JSX.Element {
  const [allowMultiple, setAllowMultiple, loading] = useConfig<boolean>(
    'live.allowMultipleWindows',
    false
  );
  const [commentDisplay, setCommentDisplay, commentDisplayLoading] = useConfig<'side' | 'window'>(
    'live.commentListDisplay',
    'side'
  );
  const [onTop, setOnTop, onTopLoading] = useConfig<boolean>('live.commentWindowOnTop', true);
  const [autoFollow, setAutoFollow, autoFollowLoading] = useConfig<boolean>(
    'live.autoFollowMoveOrder',
    false
  );
  const [followNotify, setFollowNotify, followNotifyLoading] = useConfig<boolean>(
    'live.followNotify',
    false
  );
  const [notifyInterval, setNotifyInterval, notifyIntervalLoading] = useConfig<number>(
    'live.followNotifyIntervalMin',
    5
  );

  return (
    <SettingsPage>
      <PageTitle title="生放送" />

      <Section title="プレイヤー">
        <CheckRow
          checked={allowMultiple}
          disabled={loading}
          onChange={(v) => void setAllowMultiple(v)}
          label="別の番組を新しいウィンドウで開く"
          hint="OFF の場合、開いている生放送プレイヤーで番組を切り替えます。同じ番組は設定に関わらず 1 つのウィンドウでのみ開きます。"
        />
        <CheckRow
          checked={autoFollow}
          disabled={autoFollowLoading}
          onChange={(v) => void setAutoFollow(v)}
          label="放送者の移動指示に自動で従う"
          hint="放送者が視聴者を別の番組へ誘導したとき、指定された待ち時間 (最短 5 秒) の後に自動で移動します。OFF の場合は、移動を案内するバナーを表示するだけです。"
        />
      </Section>

      <Section title="通知">
        <CheckRow
          checked={followNotify}
          disabled={followNotifyLoading}
          onChange={(v) => void setFollowNotify(v)}
          label="フォロー中の放送者が生放送を始めたら通知する"
          hint="ログイン中のみ動作します。通知をクリックすると、その番組を生放送プレイヤーで開きます。アプリを起動した直後に放送中の番組は通知しません。"
        />
        <Row label="確認間隔">
          <NumberCommitInput
            min={1}
            className="w-16"
            value={notifyInterval}
            disabled={notifyIntervalLoading || !followNotify}
            onCommit={(v) => void setNotifyInterval(Math.floor(v))}
          />
          <Hint>分 (最短 1 分)</Hint>
        </Row>
      </Section>

      <Section title="コメントリスト">
        {/* 動画プレイヤーの設定 (PlayerSettings の表示方式) と同じ表記 */}
        <Row label="表示方式" hint="プレイヤーの操作バーの「💬 タブ / 💬 浮動」ボタンで、視聴中にも切り替えられます。">
          <RadioGroup
            name="live-comment-display"
            direction="column"
            value={commentDisplay}
            onChange={(v) => void setCommentDisplay(v)}
            options={[
              { value: 'side', label: 'タブ表示', hint: 'サイドパネル内のタブとして表示', disabled: commentDisplayLoading },
              { value: 'window', label: '浮動ウィンドウ', hint: '別ウィンドウで表示。ドラッグで移動可能', disabled: commentDisplayLoading }
            ]}
          />
        </Row>
        <CheckRow
          checked={onTop}
          disabled={onTopLoading}
          onChange={(v) => void setOnTop(v)}
          label="コメントウィンドウを最前面に表示する"
        />
      </Section>
    </SettingsPage>
  );
}
