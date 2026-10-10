import { useEffect, useState } from 'react';
import type { TelemetryState } from '@shared/types';
import { TelemetryNotice } from '../telemetry/TelemetryNotice';
import { Btn, CheckRow, Hint, Section } from './common';

/** 情報タブの「匿名の利用統計」。オン/オフは即時に反映される (再起動不要) */
export function TelemetrySettings(): JSX.Element {
  const [state, setState] = useState<TelemetryState | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    window.nndd
      .invoke<TelemetryState>(window.nndd.channels.TELEMETRY_GET_STATE)
      .then(setState)
      .catch(() => {});
  }, []);

  const granted = state?.consent === 'granted' && !state.needsConsent;

  const toggle = (next: boolean): void => {
    window.nndd
      .invoke<TelemetryState>(window.nndd.channels.TELEMETRY_SET_CONSENT, next)
      .then(setState)
      .catch(() => {});
  };

  const resetId = (): void => {
    window.nndd.invoke(window.nndd.channels.TELEMETRY_RESET_ID).catch(() => {});
  };

  return (
    <Section title="匿名の利用統計">
      <CheckRow
        checked={granted}
        onChange={toggle}
        disabled={state === null}
        label="匿名の利用統計を送信する"
        hint="使われている機能や設定の傾向を知り、改善の参考にします。いつでもオフにできます。"
      />
      <div className="flex gap-2 mb-2">
        <Btn onClick={() => setShowDetail((v) => !v)}>
          {showDetail ? '送信内容を閉じる' : '送信内容を見る'}
        </Btn>
        <Btn disabled={!granted} onClick={resetId}>
          匿名IDを作り直す
        </Btn>
      </div>
      {showDetail && <TelemetryNotice />}
      {state?.consent === 'unknown' && <Hint>まだ選択していません。何も送信していません。</Hint>}
    </Section>
  );
}
