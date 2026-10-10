import { useConfig } from '@renderer/hooks/useConfig';
import { COMMENT_FONT_FAMILY } from '@shared/constants';
import {
  ButtonGroup,
  CheckRow,
  CommitInput,
  Hint,
  NumberCommitInput,
  PageTitle,
  RadioGroup,
  Row,
  Section,
  SettingsPage,
  Slider
} from './common';

/**
 * 設定 > プレイヤー。
 * 元: コメント描画関連の各オプション
 *  - 表示秒数
 *  - フォント
 *  - 不透明度
 *  - ドロップシャドウ
 *  - アンチエイリアス
 *  - ボールド
 *  - デフォルト音量
 *  - デフォルト再生速度
 *  - リピート
 *  - コメント表示
 */
export function PlayerSettings(): JSX.Element {
  const [volume, setVolume] = useConfig<number>('player.volume', 1);
  const [showComments, setShowComments] = useConfig<boolean>(
    'player.showComments',
    true
  );
  const [opacity, setOpacity] = useConfig<number>(
    'player.commentOpacity',
    1
  );
  const [sizeScale, setSizeScale] = useConfig<number>(
    'player.commentSizeScale',
    1
  );
  const [showSec, setShowSec] = useConfig<number>(
    'player.commentShowSeconds',
    3
  );
  const [fontFamily, setFontFamily] = useConfig<string>(
    'player.commentFontFamily',
    COMMENT_FONT_FAMILY
  );
  const [antiAlias, setAntiAlias] = useConfig<boolean>(
    'player.commentAntiAlias',
    true
  );
  const [bold, setBold] = useConfig<boolean>('player.commentBold', false);
  const [dropShadow, setDropShadow] = useConfig<boolean>(
    'player.commentDropShadow',
    true
  );
  const [outlineIntensity, setOutlineIntensity] = useConfig<'light' | 'normal'>(
    'player.commentOutlineIntensity',
    'light'
  );
  const [keepCA, setKeepCA] = useConfig<boolean>(
    'player.commentKeepCA',
    true
  );
  const [rate, setRate] = useConfig<number>('player.playbackRate', 1.0);
  const [keepPlaybackRate, setKeepPlaybackRate] = useConfig<boolean>(
    'player.keepPlaybackRate',
    false
  );
  const [volumeNormalize, setVolumeNormalize] = useConfig<boolean>(
    'player.volumeNormalize',
    false
  );
  const [defaultQuality, setDefaultQuality] = useConfig<'highest' | number>(
    'player.defaultQuality',
    'highest'
  );
  const [repeat, setRepeat] = useConfig<boolean>('player.repeat', false);
  const [streamingMode, setStreamingMode] = useConfig<'hls' | 'native' | 'niconico'>(
    'player.streamingMode',
    'native'
  );
  const [niconicoInheritLogin, setNiconicoInheritLogin] = useConfig<boolean>(
    'player.niconicoInheritLogin',
    true
  );
  const [commentListDisplay, setCommentListDisplay] = useConfig<'tab' | 'window'>(
    'player.commentListDisplay',
    'tab'
  );
  const [pastCommentMaxCount, setPastCommentMaxCount] = useConfig<number>(
    'player.pastCommentMaxCount',
    0
  );
  const [controlUiSize, setControlUiSize] = useConfig<'small' | 'normal' | 'large'>(
    'player.controlUiSize',
    'small'
  );
  const [openVideoLinkInPlayer, setOpenVideoLinkInPlayer] = useConfig<boolean>(
    'player.openVideoLinkInPlayer',
    true
  );
  const [resumePlayback, setResumePlayback] = useConfig<boolean>(
    'player.resumePlayback',
    false
  );
  const [jumpCommand, setJumpCommand] = useConfig<'ask' | 'auto' | 'off'>('player.jumpCommand', 'ask');
  const [controlsAlwaysVisible, setControlsAlwaysVisible] = useConfig<boolean>(
    'player.controlsAlwaysVisible',
    true
  );

  return (
    <SettingsPage>
      <PageTitle title="プレイヤー" />

      <Section title="コメント表示">
        <CheckRow checked={showComments} onChange={setShowComments} label="コメントを表示する" />
        <Row label="不透明度">
          <Slider
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onCommit={setOpacity}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row label="サイズ倍率">
          <Slider
            min={0.5}
            max={2.0}
            step={0.05}
            value={sizeScale}
            onCommit={setSizeScale}
            format={(v) => `${v.toFixed(2)}x`}
          />
          <ButtonGroup
            value={[0.75, 1.0, 1.25, 1.5].find((s) => Math.abs(sizeScale - s) < 0.01) ?? -1}
            onChange={setSizeScale}
            options={[0.75, 1.0, 1.25, 1.5].map((s) => ({ value: s, label: `${s.toFixed(2)}x` }))}
          />
        </Row>
        <Row label="流れるコメント表示秒数">
          <Slider min={1} max={8} step={0.5} value={showSec} onCommit={setShowSec} format={(v) => `${v}秒`} />
        </Row>
        <Row label="フォント">
          <CommitInput value={fontFamily} onCommit={setFontFamily} className="w-full" />
        </Row>
        <CheckRow checked={bold} onChange={setBold} label="ボールド" />
        <CheckRow checked={dropShadow} onChange={setDropShadow} label="文字の縁取りを表示" />
        {dropShadow && (
          <Row label="縁の濃さ">
            <RadioGroup
              name="outlineIntensity"
              value={outlineIntensity}
              onChange={setOutlineIntensity}
              options={[
                { value: 'light', label: '薄い' },
                { value: 'normal', label: '普通' }
              ]}
            />
          </Row>
        )}
        <CheckRow checked={antiAlias} onChange={setAntiAlias} label="アンチエイリアス" />
        <CheckRow
          checked={keepCA}
          onChange={setKeepCA}
          label="コメントアート (CA) 保護"
          hint="ONにすると歌詞・AA等のコメントアートが崩れにくくなります"
        />
      </Section>

      <Section title="ストリーミング再生">
        <Row label="再生方式">
          <RadioGroup
            name="streamingTop"
            direction="column"
            value={streamingMode === 'niconico' ? 'niconico' : 'builtin'}
            onChange={(v) => setStreamingMode(v === 'niconico' ? 'niconico' : 'native')}
            options={[
              {
                value: 'builtin',
                label: 'ストリーミング (NNDD-RE内蔵プレイヤー)',
                hint: 'コメント描画・シークバーあり',
                children:
                  streamingMode !== 'niconico' && (
                    <RadioGroup
                      name="streamingMode"
                      direction="column"
                      value={streamingMode}
                      onChange={setStreamingMode}
                      options={[
                        { value: 'native', label: 'HLS即時再生（ネイティブ）', hint: '即時再生・シーク可能。コメント描画あり。' },
                        { value: 'hls', label: 'HLS即時再生（プロキシ）', hint: 'HLS proxy 経由でニコニコCDNにアクセス。' }
                      ]}
                    />
                  )
              },
              {
                value: 'niconico',
                label: 'ニコニコ公式プレイヤー埋め込み (webview)',
                hint: 'ニコニコ動画の視聴ページで再生',
                children:
                  streamingMode === 'niconico' && (
                    <CheckRow
                      checked={niconicoInheritLogin ?? true}
                      onChange={setNiconicoInheritLogin}
                      label="NNDD-REのログイン情報を引き継ぐ"
                      hint="ONにすると nicovideo.jp Cookie を埋め込みプレイヤーに注入します"
                    />
                  )
              }
            ]}
          />
        </Row>
      </Section>

      <Section title="コメント一覧">
        <Row
          label="過去ログ同時描画制限"
          hint="過去コメント表示時に描画するコメントの上限。0 = 無制限"
        >
          <NumberCommitInput
            min={0}
            max={99999}
            step={100}
            value={pastCommentMaxCount}
            onCommit={setPastCommentMaxCount}
            className="w-24 text-right"
          />
          <Hint>{pastCommentMaxCount === 0 ? '無制限' : `最大 ${pastCommentMaxCount.toLocaleString()} 件`}</Hint>
        </Row>
        <Row label="表示方式">
          <RadioGroup
            name="commentListDisplay"
            direction="column"
            value={commentListDisplay}
            onChange={setCommentListDisplay}
            options={[
              { value: 'tab', label: 'タブ表示', hint: 'サイドパネル内のタブとして表示' },
              { value: 'window', label: '浮動ウィンドウ', hint: 'ビデオ上に重ねて表示。ドラッグで移動可能' }
            ]}
          />
        </Row>
      </Section>

      <Section title="再生">
        <Row label="デフォルト音量">
          <Slider min={0} max={1} step={0.05} value={volume} onCommit={setVolume} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <CheckRow
          checked={volumeNormalize}
          onChange={setVolumeNormalize}
          label="音量ノーマライズ"
          hint="動画間の音量差を自動で平滑化します (静かな動画は持ち上げ、大音量はピークを抑える)"
        />
        <Row label="デフォルト再生速度">
          <ButtonGroup
            value={rate}
            onChange={setRate}
            options={[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((r) => ({ value: r, label: `${r.toFixed(2)}x` }))}
          />
        </Row>
        <Row label="デフォルト画質" hint="指定画質が無い動画では自動的に最高画質にフォールバックします">
          <ButtonGroup<'highest' | number>
            value={defaultQuality}
            onChange={setDefaultQuality}
            options={[
              { value: 'highest', label: '自動 (最高画質)' },
              { value: 1080, label: '1080p以下' },
              { value: 720, label: '720p以下' },
              { value: 480, label: '480p以下' },
              { value: 360, label: '360p以下' }
            ]}
          />
        </Row>
        <CheckRow
          checked={keepPlaybackRate}
          onChange={setKeepPlaybackRate}
          label="再生速度を次の動画に引き継ぐ"
          hint="プレイヤーで変更した再生速度を次の動画にも適用 (OFF時は毎回デフォルト再生速度)"
        />
        <CheckRow checked={repeat} onChange={setRepeat} label="リピート再生" />
        <CheckRow
          checked={openVideoLinkInPlayer}
          onChange={setOpenVideoLinkInPlayer}
          label="動画リンクをプレイヤーで開く"
          hint="動画説明文の sm/nm/so 等のリンクをNNDD-REでストリーミング再生"
        />
        <CheckRow
          checked={resumePlayback}
          onChange={setResumePlayback}
          label="続きから再生する"
          hint="前回の再生位置を記憶し、次回開いた時に続きから再生 (OFF時は常に最初から)"
        />
        <Row
          label="＠ジャンプ"
          hint="投稿者コメントのニコスクリプト。別動画へ移るときだけ確認します (動画内の移動は常に即時)。「無効」では動画内の移動・ラベルも動きません"
        >
          <ButtonGroup
            value={jumpCommand}
            onChange={setJumpCommand}
            options={[
              { value: 'ask', label: '確認して移動' },
              { value: 'auto', label: '確認せず移動' },
              { value: 'off', label: '無効' }
            ]}
          />
        </Row>
        <Row label="コントロールUIサイズ" hint="シークバー・ボタン等のコントロールバー全体のサイズ">
          <ButtonGroup
            value={controlUiSize}
            onChange={setControlUiSize}
            options={[
              { value: 'small', label: '小' },
              { value: 'normal', label: '標準' },
              { value: 'large', label: '大' }
            ]}
          />
        </Row>
        <CheckRow
          checked={controlsAlwaysVisible}
          onChange={setControlsAlwaysVisible}
          label="コントロールバーを常時表示"
          hint="ウィンドウ表示時、下部コントロールバーを自動で隠さず常に表示する (フルスクリーン時は従来通り自動で隠れます)"
        />
      </Section>
    </SettingsPage>
  );
}
