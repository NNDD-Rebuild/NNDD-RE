// Linux は日本語UIフォントの字面がWindows想定フォント (Yu Gothic UI/Meiryo UI) より
// 小さく見えるため、body font-size を底上げするクラスを付与する (global.css 側で調整)
if (navigator.userAgent.includes('Linux')) {
  document.documentElement.classList.add('platform-linux');
}
