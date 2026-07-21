import { LegalDocumentScreen, type LegalDocumentSection } from '@/src/components/LegalDocumentScreen';
import { SUPPORT_EMAIL } from '@/src/constants/app';

const USER_AGREEMENT_SECTIONS: LegalDocumentSection[] = [
  {
    title: '引言',
    content:
      '欢迎使用七刷错题本。请你在使用本应用前阅读并理解本协议。你使用本应用，即表示你已了解并同意本协议内容。',
  },
  {
    title: '1. 产品定位',
    content:
      '七刷错题本是一款用于记录错题、整理错题、复做错题和导出练习卷的工具型应用。应用提供的功能主要用于提升错题复做效率，不替代学校教学、教师指导或专业学习建议。',
  },
  {
    title: '2. 用户数据',
    content:
      '你在应用中录入的错题图片、题目信息、复做记录等内容，默认保存在本机。你应自行妥善管理设备和本地数据，避免因卸载应用、清理缓存、更换设备等原因造成数据丢失。',
  },
  {
    title: '3. 合理使用',
    content:
      '你应合理、合法地使用本应用，不得利用本应用从事违法违规、侵犯他人权益、传播不当内容或破坏应用正常运行的行为。',
  },
  {
    title: '4. 内容责任',
    content:
      '你通过拍照、上传图片或录入文字保存的内容，应由你自行负责。请勿录入、保存或传播侵犯他人版权、隐私权或其他合法权益的内容。',
  },
  {
    title: '5. 导出与打印',
    content:
      '应用提供的导出练习卷、打印模板等功能，仅用于个人学习、家庭辅导或合理教学辅助场景。请勿将导出内容用于违法违规用途。',
  },
  {
    title: '6. 服务变更',
    content:
      '我们可能会根据产品规划、技术条件或合规要求，对应用功能进行调整、优化、暂停或终止部分服务。我们会尽量保证核心功能的稳定性，但不承诺所有功能永久不变。',
  },
  {
    title: '7. 免责声明',
    content:
      '由于设备环境、系统版本、存储状态、用户操作等因素不同，应用在使用过程中可能出现数据丢失、导出失败、图片显示异常等情况。建议你定期备份重要内容。',
  },
  {
    title: '8. 知识产权',
    content:
      '应用的界面设计、功能设计、代码、图标、文案等内容，除用户自行录入的数据外，相关权益归应用开发者或合法权利人所有。未经允许，不得复制、修改、传播或用于商业用途。',
  },
  {
    title: '9. 协议更新',
    content:
      '我们可能会根据产品变化或合规要求更新本协议。更新后的协议会在应用内展示。你继续使用本应用，即表示接受更新后的协议。',
  },
  {
    title: '10. 联系我们',
    content: `如果你对本协议或产品使用有任何问题，可以通过邮箱 ${SUPPORT_EMAIL} 联系我们。`,
  },
];

export default function UserAgreementScreen() {
  return (
    <LegalDocumentScreen
      title="用户协议"
      subtitle="请在使用应用前阅读并理解以下条款。"
      updatedAt="2026年5月24日"
      sections={USER_AGREEMENT_SECTIONS}
      footer={`如有疑问，请通过 ${SUPPORT_EMAIL} 联系我们。`}
    />
  );
}
