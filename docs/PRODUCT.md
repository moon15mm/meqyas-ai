# مِقياس AI — MEQYAS AI

> **من الفكرة إلى الدليل** — From idea to evidence
> AI Measurement & Impact Platform · V1.0

---

## 1. الرؤية (Vision)

مِقياس AI ليس أداة استبيانات. هو **مستشار قياس ذكي (AI Measurement Copilot)** يحوّل جملة يكتبها المستخدم بلغة طبيعية مثل:

> «أريد قياس أثر برنامج تدريبي للمعلمين على استخدام الذكاء الاصطناعي»

إلى **نظام قياس متكامل**:

```
هدف → خطة قياس → مؤشرات → استبيانات → جمع البيانات → تحليل → مقارنة → أدلة → Insights → Recommendations → تقرير أثر
```

### ما لا نبنيه
- ❌ Google Forms clone
- ❌ SurveyMonkey clone
- ❌ برنامج إحصائي معقد يحتاج خبيرًا

### ما نبنيه
- ✅ مستشار يفهم **ماذا** تريد أن تقيس و**لماذا**، ويختار التصميم المنهجي المناسب.
- ✅ يميّز بين **الرضا (Satisfaction)** و**النتائج (Outcome)** و**الأثر (Impact)** ولا يبالغ في الادعاءات.
- ✅ كل رقم محسوب برمجيًا، وكل Insight مرتبط بدليل (Evidence Traceability).
- ✅ وضعان: **بسيط** للمستخدم العادي («ماذا تريد أن تقيس؟») و**متقدم (Advanced Measurement)** للمتخصص.

---

## 2. المستخدمون (Personas) — V1: التعليم

| الشخصية | ماذا يريد | ماذا يعرف عن القياس |
|---|---|---|
| مدير/ة مدرسة | معرفة نجاح المبادرات وتقرير للإدارة | قليل |
| وكيل/ة | رضا الطلاب وأولياء الأمور | قليل |
| موجه/ة طلابي | احتياجات الطلاب، البيئة المدرسية | متوسط |
| معلم/ة | تقييم نشاط أو درس | قليل |
| مشرف/ة تربوي | تقييم برامج على مستوى عدة مدارس | متوسط |
| مسؤول مبادرة | قياس أثر مبادرة (Pre/Post) | متوسط |
| مسؤول برنامج تدريبي | تقييم تدريب (Kirkpatrick) وأثره | متوسط–عالٍ |

**التوسع لاحقًا:** الشركات، الجمعيات، الجهات الحكومية، المبادرات، الفعاليات، الموارد البشرية، العملاء. التصميم (أنواع القياس، القوالب، Sector على مستوى المشروع) لا يفترض قطاع التعليم في أي جدول أو API.

---

## 3. الرحلة الأساسية (Core Journey)

1. **ماذا تريد أن تقيس؟** — مربع نص كبير + أمثلة سريعة.
2. **Measurement Architect** (وكيل AI) يحلل الطلب ويعيد خطة منظمة (Structured JSON مُتحقق منه).
3. **مراجعة الخطة**: «فهمنا أنك تريد…»، نوع القياس ولماذا، الفئة، الأبعاد، المؤشرات، التصميم المقترح (قبل ← بعد ← متابعة)، ملاحظات منهجية.
4. المستخدم **يقبل** أو **يعدّل** → يُنشأ **مشروع** بخطة قياس مطبّعة (Goal/Objectives/Dimensions/Indicators/Waves).
5. **Survey Generator** ينشئ استبيانًا لكل موجة (قبلي/بعدي/متابعة) مرتبطًا بالأبعاد والمؤشرات.
6. **Question Reviewer** يراجع الأسئلة (تحيز، غموض، سؤال مزدوج…) + **Survey Quality Score**.
7. النشر (رابط عام `/s/{public_id}` + QR).
8. استقبال الإجابات + **Response Quality Engine**.
9. **Dashboard** وتحليلات إحصائية محسوبة برمجيًا + مقارنة Baseline vs Post.
10. تحليل النصوص المفتوحة (Sentiment, Themes).
11. **Insights** مرتبطة بالأدلة + **Recommendations**.
12. **تقرير أثر** يكتبه AI من البيانات الفعلية فقط.

---

## 4. مبادئ المنتج

1. **ابدأ بالسؤال لا بالأداة** — الشاشة الأولى «ماذا تريد أن تقيس؟» وليست قائمة تقنية.
2. **المنهجية مخفية لكنها حاضرة** — المستخدم لا يحتاج معرفة Theory of Change أو Effect Size، لكنها متاحة في Advanced Mode.
3. **الصدق المنهجي** — لا ادعاء سببية إذا كان التصميم لا يدعمها. تحذيرات تلقائية عند المبالغة.
4. **الأرقام لا يولدها LLM** — الإحصاء برمجي حتمي؛ AI يفسّر ويصوغ فقط.
5. **كل Insight له دليل** — يمكن الضغط على أي Insight لرؤية المؤشر والسؤال والإجابات والنسبة ونطاق البيانات.
6. **الخصوصية أولًا** — وضع مجهول، أقل قدر من PII، دعم AI محلي (Ollama) للمؤسسات التي لا تريد إرسال البيانات للسحابة.
7. **عربي أولًا** — RTL كامل، خطوط عربية، أرقام وتواريخ عربية، مع دعم الإنجليزية عبر i18n.
8. **Mobile-first** للاستبيانات العامة، Desktop-first مريح للمحرر والتحليلات.

---

## 5. أنواع القياس (Measurement Types)

| Enum | العربية | مستوى الدليل | التصميم الافتراضي |
|---|---|---|---|
| SATISFACTION | قياس الرضا | وصفي | بعدي فقط |
| PERCEPTION | قياس الانطباعات | وصفي | بعدي فقط |
| EXPERIENCE | قياس التجربة | وصفي | بعدي فقط / دوري |
| NEEDS_ASSESSMENT | قياس الاحتياجات | وصفي | قبل التدخل |
| AWARENESS | قياس الوعي | وصفي/تغيّر | قبلي/بعدي اختياري |
| KNOWLEDGE | قياس المعرفة | تغيّر | قبلي/بعدي |
| SKILLS | قياس المهارات | تغيّر | قبلي/بعدي |
| BEHAVIOR | قياس السلوك | تغيّر | قبلي/بعدي/متابعة |
| ENGAGEMENT | قياس الانخراط | وصفي/اتجاه | دوري |
| PROGRAM_EVALUATION | تقييم برنامج | مركّب | بعدي + مؤشرات |
| TRAINING_EVALUATION | تقييم تدريب | مركّب (Kirkpatrick 1–3) | بعدي أو قبلي/بعدي |
| OUTCOME | قياس النتائج | تغيّر | قبلي/بعدي |
| IMPACT | قياس الأثر | إسهام (Contribution) | قبلي/بعدي/متابعة |
| PRE_POST | قياس قبلي/بعدي | تغيّر | قبلي/بعدي |
| LONGITUDINAL | قياس طولي | اتجاه | موجات متعددة |
| EVENT_EVALUATION | تقييم فعالية | وصفي | بعدي فقط |
| EMPLOYEE_PULSE | نبض الموظفين | اتجاه | دوري |
| CUSTOMER_FEEDBACK | آراء العملاء | وصفي | مستمر |

### أهم ميزة: التمييز بين الرضا والنتيجة والأثر
- «أريد قياس رضا الطالبات عن النشاط» → **قياس رضا وانطباع** (لا Impact).
- «أريد معرفة هل أدى البرنامج إلى تحسن فعلي» → **Pre/Post** أو **Follow-up** حسب الحالة، مع تنبيه حدود السببية.

التفاصيل الكاملة في [`MEASUREMENT_ENGINE.md`](./MEASUREMENT_ENGINE.md).

---

## 6. خريطة الواجهة

**Sidebar (Desktop) / Bottom Navigation (Mobile):**
لوحة التحكم · المشاريع · قوالب القياس · الاستبيانات · النتائج · التقارير · مكتبة الأسئلة · المساعد الذكي · الإعدادات

**Project Workspace:** Overview · Measurement Plan · Objectives · Dimensions · Indicators · Theory of Change · Surveys · Responses · Analytics · Insights · Recommendations · Reports · Settings

**عناصر عامة:** Command Palette (`Ctrl/Cmd + K`) · زر المساعد الذكي الدائم (يفهم سياق المشروع الحالي) · مبدّل اللغة.

---

## 7. نطاق V1 (Scope)

| داخل V1 | خارج V1 (Roadmap) |
|---|---|
| Auth (Email+Password, JWT, Refresh Rotation, Reset architecture) | SSO/SAML, MFA |
| Organizations + RBAC (5 أدوار) + عزل كامل | Billing / Plans |
| Measurement Architect + خطة قياس قابلة للتعديل | Comparison groups / RCT tooling |
| Survey Builder + Logic + Versioning | Offline data collection app |
| Public Survey + QR + Anonymous modes | SMS/WhatsApp distribution |
| Analytics + Statistics + Pre/Post + Segmentation | Advanced modeling (regression, SEM) |
| Text Analytics + AI Data Analyst | Custom ML models |
| Reports (5 أنواع) + AI Report Writer + PDF | Branded white-label reports |
| Templates (تعليم) + Question Bank | Marketplace |
| Webhooks + Alerts architecture | Integrations marketplace |

---

## 8. مؤشرات نجاح المنتج (North-star)

- **Time-to-plan**: من كتابة الفكرة إلى خطة قياس مقبولة < 2 دقيقة.
- **Time-to-first-survey**: < 5 دقائق.
- نسبة الخطط المقبولة دون تعديل جوهري.
- نسبة المشاريع التي تصل إلى تقرير.
- Survey Quality Score متوسط ≥ 80.

---

## 9. علامة البيانات التجريبية

كل بيانات الـ Seed تحمل `is_demo = true` وتظهر في الواجهة بشارة **DEMO DATA** واضحة. لا تُخلط مع بيانات المستخدم الحقيقية، ويمكن حذفها بأمر واحد.
