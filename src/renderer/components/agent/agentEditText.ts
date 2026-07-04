export const DEFAULT_USER_INFO_TEMPLATE = `# USER.md - 关于你

_记录你的称呼、偏好和工作习惯。可以随时补充，Agent 会用它更好地配合你。_

- **姓名：**
- **希望如何称呼你：**
- **常用语言：** 中文
- **所在时区：**
- **沟通偏好：**
- **重要背景：**

## 工作习惯

- 

## 备注

- `;

const LEGACY_ENGLISH_USER_TEMPLATE_MARKERS = [
  '# USER.md - About Your Human',
  "Learn about the person you're helping",
  '**What to call them:**',
];

export const getEditableUserInfo = (content: string): string => {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return DEFAULT_USER_INFO_TEMPLATE;
  }

  const isLegacyEnglishTemplate = LEGACY_ENGLISH_USER_TEMPLATE_MARKERS.every(marker =>
    trimmedContent.includes(marker),
  );
  return isLegacyEnglishTemplate ? DEFAULT_USER_INFO_TEMPLATE : content;
};
