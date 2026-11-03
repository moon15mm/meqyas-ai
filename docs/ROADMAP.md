# Roadmap — خارطة الطريق

| المرحلة | المحتوى | الحالة |
|---|---|---|
| **1** | Repository · Docker · Database · Authentication · Organizations · Projects | ✅ مكتملة |
| **2** | AI Provider · AI Schemas · Measurement Architect · Measurement Plan (مراجعة/تعديل/قبول) | ✅ مكتملة |
| **3** | Survey Builder · Questions · Sections · Logic · Versioning · Survey Generator · Question Reviewer · Quality Score | ✅ مكتملة |
| **4** | Public Survey · Responses · QR · Anonymous modes · Response Quality · AI follow-up | ✅ مكتملة |
| **5** | Dashboard · Analytics · Statistics · Segmentation · Cross analysis · Exports · Results hub | ✅ مكتملة |
| **5+** | Store integrations: Salla · Zid · Shopify · WooCommerce · Custom — order webhooks → invitations → product-level satisfaction | ✅ مكتملة |
| **6** | Text Analysis · Sentiment · Themes · AI Data Analyst · Insights · Recommendations | ✅ مكتملة |
| **7** | Reports · PDF · AI Report Writer | ✅ مكتملة |
| **8** | Pre/Post · Follow-up · Indicators values · Impact Measurement · Theory of Change · Logic Model · Templates · Question Bank | ✅ مكتملة |
| **8+** | Customer experience: NPS · CSAT · CES · pulse surveys · branches (QR · kiosk · POS) · key drivers · closed loop (CX.md) | ✅ مكتملة |
| **8+** | Gifts: trial accounts sent by platform admins — survey quota, trial period, activation link, ready message (GIFTS.md) | ✅ مكتملة |
| **9.1** | Subscriptions & accounts: no self-registration · plans & subscriptions · subscribers panel (bulk, renew, suspend, members, links) · invitations · password recovery & change (SUBSCRIPTIONS.md) | ✅ مكتملة |

## ما بعد V1
- قوالب خاصة بالمؤسسة («حفظ المشروع كقالب») وقوالب بالإنجليزية.
- ملف PDF يُولَّد على الخادم للإرسال المجدول (عامل Playwright يطبع صفحة التقرير نفسها، D-042).
- مقارنة الجولات المتكررة على مستوى الاتجاه الزمني الكامل (منحنى عبر كل الجولات) في التقارير.
- Import (Excel/CSV/Word/PDF → Survey) و Export (CSV/Excel/PDF/JSON) الكامل.
- Dashboard Builder (Widgets قابلة للترتيب) و Alerts.
- Webhooks UI و API Keys.
- **المرحلة 9.2 — الدفع:** أسعار الباقات، بوابة دفع محلية (مدى وApple Pay)، الفواتير الضريبية، والاشتراك الذاتي بالبطاقة فوق جداول الاشتراكات الحالية.
- Comparison groups (شبه تجريبي) لرفع مستوى الدليل إلى CONTRIBUTION.
- Row Level Security في PostgreSQL كطبقة عزل إضافية.
- SSO/SAML و MFA.
- قنوات توزيع: WhatsApp / SMS / Email campaigns (دعوات المتاجر وحالات المتابعة جاهزة لاستخدامها).
- تنبيهات فورية لحالات المتابعة (بريد/Slack) ومسؤول لكل فرع، وتكاملات رسمية مع أنظمة نقاط البيع (Foodics وغيرها).
- تطبيقات رسمية بنقرة واحدة في متاجر تطبيقات سلة وزد وShopify (OAuth وتسجيل Webhooks تلقائي).
- قوالب لقطاعات: الشركات، الجمعيات، الحكومة، الفعاليات، الموارد البشرية، العملاء.
- Embeddings + بحث دلالي في مكتبة الأسئلة.

تُحدَّث هذه الوثيقة في نهاية كل مرحلة.
