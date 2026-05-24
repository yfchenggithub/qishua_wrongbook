import { LegalDocumentScreen, type LegalDocumentSection } from '@/src/components/LegalDocumentScreen';
import { SUPPORT_EMAIL } from '@/src/constants/app';

const PRIVACY_POLICY_SECTIONS: LegalDocumentSection[] = [
  {
    title: '引言',
    content:
      '七刷错题本是一款用于本地记录、整理和复习错题的工具型应用。我们重视你的隐私与数据安全，并尽量减少不必要的数据收集。',
  },
  {
    title: '1. 我们如何处理你的错题数据',
    content:
      '你的错题图片、题目信息、复做记录、分类标签等数据，默认保存在你的设备本地。当前版本不会主动将你的错题数据上传到服务器。',
  },
  {
    title: '2. 我们可能使用的权限',
    content:
      '为了提供拍照、选择图片、保存导出文件等功能，应用可能会请求相机、相册或文件存储相关权限。这些权限仅用于你主动使用的功能，例如拍摄错题、导入图片、导出练习卷等。',
  },
  {
    title: '3. 我们不会主动收集的信息',
    content:
      '当前版本不要求你注册账号，也不会主动收集你的真实姓名、身份证号、通讯录、精确定位等与错题管理无关的信息。',
  },
  {
    title: '4. 本地数据的管理',
    content:
      '由于错题数据默认保存在本机，如果你卸载应用、清理应用数据或更换设备，可能会导致本地数据丢失。请在重要数据较多时，及时使用导出功能进行备份。',
  },
  {
    title: '5. 反馈与联系',
    content:
      '当你通过邮箱向我们反馈问题时，我们可能会收到你的邮箱地址、问题描述、截图或你主动提供的信息。这些信息仅用于问题定位、用户支持和产品改进。',
  },
  {
    title: '6. 第三方服务',
    content:
      '当前版本主要为离线本地使用。如后续接入广告、统计、云同步、账号登录等第三方服务，我们会在隐私政策中说明相关数据使用情况，并在必要时征得你的授权。',
  },
  {
    title: '7. 未成年人使用',
    content:
      '本应用主要面向学习场景使用。未成年人使用本应用时，建议在监护人指导下进行，尤其是在导出、分享或反馈问题时，避免上传与学习无关的个人敏感信息。',
  },
  {
    title: '8. 政策更新',
    content:
      '我们可能会根据功能变化、产品迭代或合规要求更新本隐私政策。更新后会在应用内展示新的版本。',
  },
  {
    title: '9. 联系我们',
    content: `如果你对隐私政策或数据处理方式有任何疑问，可以通过邮箱 ${SUPPORT_EMAIL} 联系我们。`,
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocumentScreen
      title="隐私政策"
      subtitle="七刷错题本重视你的数据与隐私安全。"
      updatedAt="2026年5月24日"
      sections={PRIVACY_POLICY_SECTIONS}
      footer={`如有疑问，请通过 ${SUPPORT_EMAIL} 联系我们。`}
    />
  );
}
