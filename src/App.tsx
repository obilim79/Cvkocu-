/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Sparkles, 
  Loader2, 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  ChevronRight, 
  ArrowLeft, 
  AlertTriangle, 
  Image as ImageIcon, 
  ClipboardList, 
  Mail, 
  Layout,
  FileIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// --- Gemini API Setup ---
const getApiKey = () => {
  // Check both possible names and ensure it's not a placeholder
  const key = process.env.GEMINI_API || process.env.GEMINI_API_KEY;
  if (!key || 
      key === "MY_GEMINI_API" || 
      key === "MY_GEMINI_API_KEY" || 
      key === "undefined" || 
      key === "null" ||
      key.length < 10) {
    return "";
  }
  return key;
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });
const MODEL_NAME = "gemini-flash-latest";

const safeArray = (data: any) => Array.isArray(data) ? data : (typeof data === 'string' ? data.split(',').map(i => i.trim()) : (data ? [String(data)] : []));

export default function App() {
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState("");

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setErrorDetails(event.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Bir Hata Oluştu</h1>
        <p className="text-slate-400 mb-4">Uygulama yüklenirken bir sorunla karşılaşıldı.</p>
        <div className="bg-slate-800 p-4 rounded-lg text-xs font-mono text-left max-w-full overflow-auto">
          {errorDetails}
        </div>
        <button 
          onClick={() => window.location.reload()} 
          className="mt-6 bg-blue-600 px-6 py-2 rounded-full font-bold"
        >
          Yeniden Dene
        </button>
      </div>
    );
  }

  const [step, setStep] = useState('input');
  
  const [cvText, setCvText] = useState("");
  const [targetJob, setTargetJob] = useState("");
  const [pdfData, setPdfData] = useState<{ name: string, base64: string, mimeType: string } | null>(null);
  const [photoData, setPhotoData] = useState<string | null>(null);
  
  const [interviewData, setInterviewData] = useState<{ experiences: any[], questions: any[] }>({ experiences: [], questions: [] });
  const [userAnswers, setUserAnswers] = useState<Record<string, { done: boolean | null, expIds: string[] }>>({}); 
  
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [selections, setSelections] = useState<any>({ summary: true, experiences: {}, education: true, skills_and_languages: true, dynamic: {} });
  
  const [activeTab, setActiveTab] = useState<'cv' | 'cover_letter'>('cv');
  const [activeLang, setActiveLang] = useState<'tr' | 'en'>('tr');
  const [selectedTemplate, setSelectedTemplate] = useState<'modern' | 'classic' | 'minimal' | 'elegant' | 'technical' | 'professional'>('modern');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [isExporting, setIsExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Hide scrollbar and iOS specific CSS
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .hide-scrollbar::-webkit-scrollbar { display: none; }
      .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      .ios-scroll { -webkit-overflow-scrolling: touch; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === "text/plain") {
      const reader = new FileReader();
      reader.onload = (ev) => setCvText(prev => prev + "\n" + (ev.target?.result as string));
      reader.readAsText(file);
    } else if (file.type === "application/pdf" || file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setPdfData({ 
        name: file.name, 
        base64: (ev.target?.result as string).split(',')[1], 
        mimeType: file.type 
      });
      reader.readAsDataURL(file);
    }
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setPhotoData(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
    if(photoInputRef.current) photoInputRef.current.value = "";
  };

  // --- 1. AŞAMA YAPAY ZEKA: 50 SORULUK MÜLAKAT ---
  const handleGenerateQuestions = async () => {
    if (!cvText.trim() && !pdfData) { setError("Lütfen işlem yapılacak bir CV yükleyin."); return; }
    setStep('generating_questions');
    setError(null);

    const systemPrompt = `
      Sen uzman bir Kariyer Koçusun. Kullanıcının CV'sini incele. 
      1. CV'deki "İş Deneyimleri"ni EKSİKSİZ, HİÇBİRİNİ ATLAMADAN tespit et (Şirket adı ve Pozisyon olarak).
      2. Kullanıcının mesleğini ve tecrübelerini çok iyi tara, eksik kalmasın.
      3. Kullanıcının hedeflenen pozisyonuna uygun TAM OLARAK 50 ADET spesifik, teknik soru oluştur.
      
      ÇOK ÖNEMLİ KURAL: 
      Soruların TAMAMI "Evet/Hayır" veya "Yaptım/Yapmadım" şeklinde cevaplanabilecek KAPALI UÇLU sorular olmalıdır. 
      (Örn: "Kurumlar Vergisi beyannamesi düzenlediniz mi?", "React Hook'ları ile state yönetimi yaptınız mı?")
      KESİNLİKLE açık uçlu soru (Nasıl yaparsınız, süreç nasıldı vb.) SORMA.
      
      SADECE AŞAĞIDAKİ JSON ŞEMASINDA YANIT VER.
      {
        "extracted_experiences": [
          { "id": "exp_1", "label": "Firma Adı - Pozisyon" }
        ],
        "questions": [
          { "id": "q1", "text": "Soru 1 (Kapalı Uçlu)" }
        ]
      }
    `;

    const contents: any[] = [];
    if (targetJob) contents.push({ text: `Hedef Pozisyon: ${targetJob}` });
    if (cvText) contents.push({ text: `CV Metni:\n${cvText}` });
    if (pdfData) contents.push({ inlineData: { mimeType: pdfData.mimeType, data: pdfData.base64 } });

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("Gemini API anahtarı bulunamadı. Lütfen AI Studio 'Secrets' panelinden GEMINI_API_KEY anahtarını kontrol edin.");
      }

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ parts: contents }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
        }
      });

      const text = response.text;
      if (!text) throw new Error("Yapay zekadan boş yanıt döndü.");
      
      const cleanText = text.replace(/```json\n?|```/g, '').trim();
      const data = JSON.parse(cleanText);
      
      const experiences = safeArray(data.extracted_experiences);
      experiences.unshift({ id: "general", label: "Tüm Kariyerim / Genel Yetenek" });
      
      setInterviewData({ experiences: experiences, questions: safeArray(data.questions) });
      
      const initialAnswers: Record<string, { done: boolean | null, expIds: string[] }> = {};
      safeArray(data.questions).forEach((q: any) => { initialAnswers[q.id] = { done: null, expIds: [] }; });
      setUserAnswers(initialAnswers);
      
      setStep('questionnaire');
    } catch (err: any) {
      console.error("AI Error:", err);
      setError(`Mülakat hazırlanırken hata oluştu: ${err.message || "Bilinmeyen hata"}`);
      setStep('input');
    }
  };

  const handleAnswerChange = (qId: string, isDone: boolean) => {
    setUserAnswers(prev => ({ ...prev, [qId]: { done: isDone, expIds: isDone ? prev[qId].expIds : [] } }));
  };

  const toggleExperienceForQuestion = (qId: string, expId: string) => {
    setUserAnswers(prev => {
      const currentExpIds = prev[qId].expIds || [];
      const newExpIds = currentExpIds.includes(expId) ? currentExpIds.filter(id => id !== expId) : [...currentExpIds, expId]; 
      return { ...prev, [qId]: { ...prev[qId], expIds: newExpIds } };
    });
  };

  // --- 2. AŞAMA YAPAY ZEKA: CV İNŞASI & ÇEVİRİ & ÖN YAZI ---
  const handleAnalyzeAndBuild = async () => {
    setStep('analyzing');
    setError(null);

    const confirmedList = interviewData.questions
      .filter(q => userAnswers[q.id]?.done === true)
      .map(q => {
        const expLabels = userAnswers[q.id].expIds.map(eId => interviewData.experiences.find(e => e.id === eId)?.label || "Genel");
        const labelStr = expLabels.length > 0 ? expLabels.join(", ") : "Genel";
        return `[${labelStr}] -> ${q.text}`;
      });

    const systemPrompt = `
      Sen uzman bir İK Uzmanısın. Kullanıcının CV'sini ve KULLANICININ ONAYLADIĞI İŞLERİ (Mülakat verilerini) dikkate alarak CV'yi yeniden inşa et.
      Ayrıca bu hedef pozisyona özel PROFESYONEL BİR ÖN YAZI (Cover Letter) oluştur.
      Son olarak TÜM İÇERİKLERİ İNGİLİZCEYE ÇEVİR.
      
      ATS SKORLAMA GÖREVİ:
      1. Kullanıcının ESKİ (ilk yüklediği) CV'sine 100 üzerinden bir ATS skoru ver.
      2. Senin oluşturduğun YENİ (zenginleştirilmiş) CV'ye 100 üzerinden bir ATS skoru ver.
      Skorları verirken anahtar kelime uyumu, format, detaylandırma ve profesyonellik kriterlerini baz al.

      ÇOK ÖNEMLİ KURALLAR:
      1. İş deneyimlerini SONDAN BAŞA (en yeni tarihli en üstte) kronolojik olarak diz.
      2. En son tarihli (en yeni) 5 iş deneyimini detaylı şekilde (başarılar, görevler) yaz.
      3. 5'ten daha eski olan iş deneyimlerini "Önceki Deneyimler" (Previous Experiences) başlığı altında tek bir paragrafta veya kısa bir listede birleştirerek özetle.
      4. KESİNLİKLE HİÇBİR ŞEYİ KISALTMA, KIRPMA VE BOZMA (ilk 5 iş için geçerli).
      5. CV'nin uzun olması sorun değildir.
      
      KULLANICININ ONAYLADIĞI İŞLER:
      ${confirmedList.length > 0 ? confirmedList.join('\n') : 'Ekstra mülakat verisi yok.'}
      HEDEF POZİSYON: ${targetJob || "Belirtilmemiş"}
 
      JSON ŞEMASI (Lütfen SADECE bu şemada yanıt ver):
      {
        "ats_score_original": 45,
        "ats_score_proposed": 85,
        "general_review": "Genel değerlendirme (Türkçe)",
        "cv": {
          "tr": {
            "personal_info": { "fullName": "Ad Soyad", "title": "Unvan", "contact": "E-posta | Tel | Adres" },
            "summary": { "original": "Mevcut Özet", "proposed": "Önerilen Detaylı Yeni Özet" },
            "experiences": [
              { "id": "exp_1", "company": "Şirket", "title": "Pozisyon", "date": "Tarih", "original_desc": "Mevcut", "proposed_achievements": ["Detaylı Madde 1", "Detaylı Madde 2"] }
            ],
            "education": { "original": "Mevcut", "proposed_list": [{ "degree": "Derece", "school": "Okul", "date": "Tarih" }] },
            "skills_and_languages": { "original": ["Yetenek"], "proposed": ["Yetenek 1"] },
            "dynamic_sections": [
              { "id": "sec_1", "title": "Sertifikalar / Diğer", "original_desc": "Mevcut", "proposed_items": ["Madde 1"] }
            ]
          },
          "en": {
            "personal_info": { "fullName": "Full Name", "title": "Title", "contact": "Email | Phone | Address" },
            "summary": "Translated proposed summary",
            "experiences": [
              { "id": "exp_1", "company": "Company", "title": "Position", "date": "Date", "proposed_achievements": ["Point 1", "Point 2"] }
            ],
            "education": [{ "degree": "Degree", "school": "School", "date": "Date" }],
            "skills_and_languages": ["Skill 1"],
            "dynamic_sections": [
              { "id": "sec_1", "title": "Certificates", "proposed_items": ["Item 1"] }
            ]
          }
        },
        "cover_letter": {
          "tr": "Detaylı Ön Yazı Metni (Satır sonlarını \\n ile belirt)",
          "en": "Detailed Cover Letter Text (Separate paragraphs with \\n)"
        }
      }
    `;

    const contents: any[] = [];
    if (cvText) contents.push({ text: `Mevcut CV Metni:\n${cvText}` });
    if (pdfData) contents.push({ inlineData: { mimeType: pdfData.mimeType, data: pdfData.base64 } });

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ parts: contents }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0.1,
        }
      });
      
      const text = response.text;
      if (!text) throw new Error("Yapay zekadan boş yanıt döndü.");
      
      const cleanText = text.replace(/```json\n?|```/g, '').trim();
      const data = JSON.parse(cleanText);

      setAnalysisData(data);
      
      const initSel: any = { summary: true, experiences: {}, education: true, skills_and_languages: true, dynamic: {} };
      if(data.cv?.tr?.experiences) {
        data.cv.tr.experiences.forEach((e: any) => initSel.experiences[e.id] = true);
      }
      if(data.cv?.tr?.dynamic_sections) {
        data.cv.tr.dynamic_sections.forEach((s: any) => initSel.dynamic[s.id] = true);
      }
      setSelections(initSel);
      setStep('ats_report');
    } catch (err: any) {
      console.error("AI Error:", err);
      setError(`CV oluşturulurken bir hata oluştu: ${err.message || "Bilinmeyen hata"}`);
      setStep('questionnaire');
    }
  };

  const setSelectionValue = (category: string, id: string | null, value: boolean) => {
    if (id !== null) setSelections((prev: any) => ({ ...prev, [category]: { ...prev[category], [id]: value } }));
    else setSelections((prev: any) => ({ ...prev, [category]: value }));
  };

  const handleDownloadDocx = async () => {
    if (!analysisData || !analysisData.cv) return;
    setIsExporting(true);
    
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign } = await import('docx');
      const { saveAs } = await import('file-saver');
      
      const langData = activeLang === 'tr' ? analysisData.cv.tr : analysisData.cv.en;
      const personalInfo = langData.personal_info || {};
      const isTr = activeLang === 'tr';

      const base64ToUint8Array = (base64: string) => {
        const parts = base64.split(',');
        const binaryString = window.atob(parts.length > 1 ? parts[1] : parts[0]);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      };

      const getImageType = (base64: string) => {
        const match = base64.match(/^data:image\/([a-z]+);base64,/);
        const type = match ? match[1] : "png";
        if (type === 'jpeg') return 'jpg';
        return type;
      };

      let photoImageRun = null;
      if (photoData) {
        try {
          const photoBytes = base64ToUint8Array(photoData);
          const photoType = getImageType(photoData);
          photoImageRun = new ImageRun({
            data: photoBytes,
            transformation: { width: 100, height: 100 },
            type: photoType as any,
          });
        } catch (e) {
          console.error("Photo processing error:", e);
        }
      }

      const isClassic = selectedTemplate === 'classic';
      const isMinimal = selectedTemplate === 'minimal';
      const isElegant = selectedTemplate === 'elegant';
      const isTechnical = selectedTemplate === 'technical';
      const isProfessional = selectedTemplate === 'professional';
      const isModern = selectedTemplate === 'modern';

      // Design variables
      const primaryColor = isTechnical ? "38bdf8" : (isProfessional ? "2563eb" : (isElegant ? "8c7867" : (isModern ? "4f46e5" : "000000")));
      const secondaryColor = isTechnical ? "94a3b8" : "64748b";
      const font = isClassic || isElegant ? "Times New Roman" : (isTechnical ? "Courier New" : "Arial");
      const headingSize = isTechnical ? 20 : 24;

      // Helper to create headings
      const createHeading = (text: string) => {
        const borderStyle = isMinimal ? BorderStyle.NONE : (isTechnical ? BorderStyle.DOTTED : BorderStyle.SINGLE);
        return new Paragraph({
          children: [new TextRun({ text, bold: true, color: primaryColor, size: headingSize, font, allCaps: true })],
          spacing: { before: 400, after: 200 },
          border: { bottom: { color: primaryColor, space: 1, style: borderStyle, size: 6 } },
          alignment: isMinimal ? AlignmentType.LEFT : (isProfessional ? AlignmentType.LEFT : AlignmentType.CENTER)
        });
      };

      const createSubHeading = (text: string, sub: string, date: string) => new Paragraph({
        children: [
          new TextRun({ text, bold: true, size: 22, font }),
          new TextRun({ text: ` | ${sub}`, italics: isElegant, size: 20, font, color: secondaryColor }),
          new TextRun({ text: ` (${date})`, size: 18, font, color: "94a3b8" })
        ],
        spacing: { before: 200, after: 100 },
        alignment: isMinimal ? AlignmentType.LEFT : (isProfessional ? AlignmentType.LEFT : AlignmentType.CENTER)
      });

      let children: any[] = [];

      if (isProfessional) {
        // 2-Column Layout using Table
        const leftCol: any[] = [];
        if (photoImageRun) {
          leftCol.push(new Paragraph({ children: [photoImageRun], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
        }
        leftCol.push(new Paragraph({ children: [new TextRun({ text: personalInfo.fullName, bold: true, size: 28, font })], alignment: AlignmentType.CENTER }));
        leftCol.push(new Paragraph({ children: [new TextRun({ text: personalInfo.title, color: primaryColor, size: 20, font, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));
        
        leftCol.push(createHeading(isTr ? "İLETİŞİM" : "CONTACT"));
        String(personalInfo.contact || "").split('|').forEach(item => {
          leftCol.push(new Paragraph({ children: [new TextRun({ text: `• ${item.trim()}`, size: 16, font })] }));
        });

        // Skills
        const finalSkills = isTr ? (selections.skills_and_languages ? safeArray(langData.skills_and_languages.proposed) : safeArray(langData.skills_and_languages.original)) : safeArray(langData.skills_and_languages);
        if (finalSkills.length > 0) {
          leftCol.push(new Paragraph({ children: [new TextRun({ text: isTr ? "YETENEKLER" : "SKILLS", bold: true, size: 18, font, color: primaryColor })], spacing: { before: 300, after: 100 } }));
          finalSkills.forEach((s: string) => {
            leftCol.push(new Paragraph({ children: [new TextRun({ text: `• ${s}`, size: 16, font })] }));
          });
        }

        const rightCol: any[] = [];
        rightCol.push(createHeading(isTr ? "PROFİL" : "PROFILE"));
        rightCol.push(new Paragraph({ 
          children: [new TextRun({ text: isTr ? (selections.summary ? langData.summary.proposed : langData.summary.original) : (langData.summary || ""), font })],
          spacing: { after: 200 }
        }));

        rightCol.push(createHeading(isTr ? "DENEYİM" : "EXPERIENCE"));
        safeArray(langData.experiences).forEach((exp: any) => {
          rightCol.push(createSubHeading(exp.title, exp.company, exp.date));
          safeArray(isTr ? (selections.experiences[exp.id] ? exp.proposed_achievements : exp.original_desc) : exp.proposed_achievements).forEach(desc => {
            rightCol.push(new Paragraph({ children: [new TextRun({ text: `• ${desc}`, size: 18, font })], indent: { left: 360 } }));
          });
        });

        // Dynamic Sections for Professional
        const finalDynamics = safeArray(langData.dynamic_sections).map((sec: any) => ({
          ...sec, finalDesc: isTr ? (selections.dynamic[sec.id] ? safeArray(sec.proposed_items) : safeArray(sec.original_desc)) : safeArray(sec.proposed_items)
        }));
        finalDynamics.forEach((sec: any) => {
          rightCol.push(createHeading(sec.title));
          sec.finalDesc.forEach((item: string) => {
            rightCol.push(new Paragraph({ children: [new TextRun({ text: `• ${item}`, size: 18, font })], indent: { left: 360 } }));
          });
        });

        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: leftCol, width: { size: 35, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, verticalAlign: VerticalAlign.TOP }),
                new TableCell({ children: rightCol, width: { size: 65, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, verticalAlign: VerticalAlign.TOP })
              ]
            })
          ]
        }));
      } else {
        // Standard Layout (Modern, Classic, Minimal, Elegant, Technical)
        // Header
        if (isMinimal) {
           if (photoImageRun) {
             children.push(new Paragraph({ children: [photoImageRun], alignment: AlignmentType.LEFT, spacing: { after: 200 } }));
           }
           children.push(new Paragraph({ children: [new TextRun({ text: personalInfo.fullName, bold: true, size: 36, font })], alignment: AlignmentType.LEFT }));
           children.push(new Paragraph({ children: [new TextRun({ text: personalInfo.title, size: 24, font, color: primaryColor, bold: true })], alignment: AlignmentType.LEFT }));
           children.push(new Paragraph({ children: [new TextRun({ text: String(personalInfo.contact || "").replace(/\|/g, ' • '), size: 18, font, color: secondaryColor })], alignment: AlignmentType.LEFT, spacing: { after: 400 } }));
        } else if (isTechnical) {
           if (photoImageRun) {
             children.push(new Paragraph({ children: [photoImageRun], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
           }
           children.push(new Paragraph({ children: [new TextRun({ text: personalInfo.fullName, bold: true, size: 36, font, color: "000000" })], alignment: AlignmentType.CENTER }));
           children.push(new Paragraph({ children: [new TextRun({ text: personalInfo.title, size: 24, font, color: primaryColor, bold: true })], alignment: AlignmentType.CENTER }));
           children.push(new Paragraph({ children: [new TextRun({ text: String(personalInfo.contact || "").replace(/\|/g, ' • '), size: 18, font, color: secondaryColor })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));
        } else {
           if (photoImageRun) {
             children.push(new Paragraph({ children: [photoImageRun], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
           }
           children.push(new Paragraph({ children: [new TextRun({ text: personalInfo.fullName, bold: true, size: 36, font })], alignment: AlignmentType.CENTER }));
           children.push(new Paragraph({ children: [new TextRun({ text: personalInfo.title, size: 24, font, color: primaryColor, bold: true })], alignment: AlignmentType.CENTER }));
           children.push(new Paragraph({ children: [new TextRun({ text: String(personalInfo.contact || "").replace(/\|/g, ' • '), size: 18, font, color: secondaryColor })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));
        }

        children.push(createHeading(isTr ? "PROFİL" : "PROFILE"));
        children.push(new Paragraph({ 
          children: [new TextRun({ text: isTr ? (selections.summary ? langData.summary.proposed : langData.summary.original) : (langData.summary || ""), font })],
          spacing: { after: 200 }
        }));

        children.push(createHeading(isTr ? "DENEYİM" : "EXPERIENCE"));
        safeArray(langData.experiences).forEach((exp: any) => {
          children.push(createSubHeading(exp.title, exp.company, exp.date));
          safeArray(isTr ? (selections.experiences[exp.id] ? exp.proposed_achievements : exp.original_desc) : exp.proposed_achievements).forEach(desc => {
            children.push(new Paragraph({ children: [new TextRun({ text: `• ${desc}`, size: 18, font })], indent: { left: 360 } }));
          });
        });

        // Skills
        const finalSkills = isTr ? (selections.skills_and_languages ? safeArray(langData.skills_and_languages.proposed) : safeArray(langData.skills_and_languages.original)) : safeArray(langData.skills_and_languages);
        if (finalSkills.length > 0) {
          children.push(createHeading(isTr ? "YETENEKLER" : "SKILLS"));
          children.push(new Paragraph({ children: [new TextRun({ text: finalSkills.join(" • "), font, size: 18 })] }));
        }

        // Education
        const finalEducation = isTr ? (selections.education ? safeArray(langData.education.proposed_list) : [{ degree: langData.education.original || "" }]) : safeArray(langData.education);
        if (finalEducation.length > 0) {
          children.push(createHeading(isTr ? "EĞİTİM" : "EDUCATION"));
          finalEducation.forEach((edu: any) => {
            children.push(new Paragraph({
              children: [
                new TextRun({ text: edu.degree, bold: true, font, size: 20 }),
                new TextRun({ text: ` - ${edu.school} (${edu.date || ""})`, font, size: 18 })
              ]
            }));
          });
        }

        // Dynamic Sections
        const finalDynamics = safeArray(langData.dynamic_sections).map((sec: any) => ({
          ...sec, finalDesc: isTr ? (selections.dynamic[sec.id] ? safeArray(sec.proposed_items) : safeArray(sec.original_desc)) : safeArray(sec.proposed_items)
        }));
        finalDynamics.forEach((sec: any) => {
          children.push(createHeading(sec.title));
          sec.finalDesc.forEach((item: string) => {
            children.push(new Paragraph({ children: [new TextRun({ text: `• ${item}`, size: 18, font })], indent: { left: 360 } }));
          });
        });
      }

      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `${personalInfo.fullName.replace(/\s+/g, '_')}_CV.docx`);
    } catch (err) {
      console.error("DOCX Export Error:", err);
      setError("DOCX oluşturulurken bir hata oluştu.");
    } finally {
      setIsExporting(false);
    }
  };

  // --- SON EKRAN: 9:16 RENDER MOTORU & ŞABLONLAR ---
  
  const PhotoRenderer = ({ className }: { className: string }) => photoData ? <img src={photoData} alt="Profile" className={className} referrerPolicy="no-referrer" /> : null;

  const renderCV = (isExport: boolean = false) => {
    if (!analysisData || !analysisData.cv) return null;
    
    const langData = activeLang === 'tr' ? analysisData.cv.tr : analysisData.cv.en;
    const isTr = activeLang === 'tr';
    const personalInfo = langData.personal_info || {};
    
    let finalSummary = isTr ? (selections.summary ? langData.summary.proposed : langData.summary.original) : (langData.summary || ""); 
    let finalSkills = isTr ? (selections.skills_and_languages ? safeArray(langData.skills_and_languages.proposed) : safeArray(langData.skills_and_languages.original)) : safeArray(langData.skills_and_languages);
    
    const finalExperiences = safeArray(langData.experiences).map((exp: any) => ({
      ...exp, finalDesc: isTr ? (selections.experiences[exp.id] ? safeArray(exp.proposed_achievements) : safeArray(exp.original_desc)) : safeArray(exp.proposed_achievements)
    }));
    
    let finalEducation = isTr ? (selections.education ? safeArray(langData.education.proposed_list) : [{ degree: langData.education.original || "" }]) : safeArray(langData.education);
    
    const finalDynamics = safeArray(langData.dynamic_sections).map((sec: any) => ({
      ...sec, finalDesc: isTr ? (selections.dynamic[sec.id] ? safeArray(sec.proposed_items) : safeArray(sec.original_desc)) : safeArray(sec.proposed_items)
    }));

    // Şablona Göre Stil Ayarları
    const isClassic = selectedTemplate === 'classic';
    const isMinimal = selectedTemplate === 'minimal';
    const isModern = selectedTemplate === 'modern';
    const isElegant = selectedTemplate === 'elegant';
    const isTechnical = selectedTemplate === 'technical';
    const isProfessional = selectedTemplate === 'professional';

    const pageClass = `${isExport ? 'w-[210mm] min-h-[297mm] mb-0 shadow-none' : 'w-full h-full snap-start snap-always flex-shrink-0 flex flex-col p-6 overflow-y-auto hide-scrollbar ios-scroll'} text-justify p-10 ${
      isClassic ? 'font-serif bg-[#fdfbf7] text-slate-900' : 
      isMinimal ? 'font-sans bg-white text-slate-600' : 
      isElegant ? 'font-serif bg-[#faf7f2] text-[#4a3f35]' :
      isTechnical ? 'font-mono bg-[#0f172a] text-[#94a3b8]' :
      isProfessional ? 'font-sans bg-white text-slate-800' :
      'font-sans bg-slate-50 text-slate-800'
    }`;

    const headingClass = `uppercase tracking-widest mb-4 pb-2 border-b ${
      isClassic ? 'text-sm font-bold border-slate-800 text-slate-800' : 
      isMinimal ? 'text-xs font-semibold border-slate-100 text-slate-400' : 
      isElegant ? 'text-sm font-medium border-[#d4c5b9] text-[#8c7867]' :
      isTechnical ? 'text-xs font-bold border-[#1e293b] text-[#38bdf8] font-mono' :
      isProfessional ? 'text-sm font-bold border-blue-600 text-blue-700' :
      'text-xs font-bold border-slate-200 text-blue-600'
    }`;

    if (isProfessional) {
      return (
        <div className={pageClass}>
          <div className="flex flex-col md:flex-row gap-8 h-full">
            {/* Left Column */}
            <div className="md:w-1/3 flex flex-col gap-8 border-r border-slate-100 pr-6">
              <div className="flex flex-col items-center text-center">
                <div className="w-32 h-32 mb-4 rounded-2xl overflow-hidden shadow-lg border-4 border-white">
                  {photoData ? <PhotoRenderer className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-200 flex items-center justify-center"><ImageIcon className="w-8 h-8 text-slate-400" /></div>}
                </div>
                <h1 className="text-xl font-bold text-slate-900">{personalInfo.fullName}</h1>
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mt-1">{personalInfo.title}</p>
              </div>

              <div>
                <h3 className={headingClass}>{isTr ? 'İletişim' : 'Contact'}</h3>
                <div className="space-y-2 text-[11px] text-slate-600">
                  {String(personalInfo.contact || "").split('|').map((item, i) => <div key={i} className="flex items-center gap-2"><span>•</span> {item.trim()}</div>)}
                </div>
              </div>

              {finalSkills.length > 0 && (
                <div>
                  <h3 className={headingClass}>{isTr ? 'Yetenekler' : 'Skills'}</h3>
                  <div className="flex flex-wrap gap-2">
                    {finalSkills.map((s: string, i: number) => (
                      <span key={i} className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-[10px] font-medium">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {finalEducation.length > 0 && (
                <div>
                  <h3 className={headingClass}>{isTr ? 'Eğitim' : 'Education'}</h3>
                  <div className="space-y-4">
                    {finalEducation.map((edu: any, i: number) => (
                      <div key={i}>
                        <h4 className="font-bold text-[11px] text-slate-800">{edu.degree}</h4>
                        <p className="text-[10px] text-slate-600">{edu.school}</p>
                        {edu.date && <p className="text-[9px] text-slate-400 mt-0.5">{edu.date}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div className="md:w-2/3 flex flex-col gap-8">
              {finalSummary && (
                <div>
                  <h3 className={headingClass}>{isTr ? 'Profil' : 'Profile'}</h3>
                  <p className="text-[12px] leading-relaxed text-slate-700">{finalSummary}</p>
                </div>
              )}

              {finalExperiences.length > 0 && (
                <div>
                  <h3 className={headingClass}>{isTr ? 'Deneyim' : 'Experience'}</h3>
                  <div className="space-y-6">
                    {finalExperiences.map((exp: any, i: number) => (
                      <div key={i}>
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-bold text-[13px] text-slate-900">{exp.title}</h4>
                          <span className="text-[10px] font-semibold text-slate-400">{exp.date}</span>
                        </div>
                        <p className="text-[11px] font-bold text-blue-600 mb-2">{exp.company}</p>
                        <div className="space-y-1.5">
                          {exp.finalDesc.map((desc: string, j: number) => (
                            <p key={j} className="text-[11px] text-slate-600 pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[6px] before:w-1 before:h-1 before:rounded-full before:bg-blue-400">
                              {desc}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {finalDynamics.map((sec: any, i: number) => (
                <div key={i}>
                  <h3 className={headingClass}>{sec.title}</h3>
                  <div className="space-y-2">
                    {sec.finalDesc.map((desc: string, j: number) => (
                      <p key={j} className="text-[11px] text-slate-600 pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[6px] before:w-1 before:h-1 before:rounded-full before:bg-slate-300">
                        {desc}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    const content = (
      <>
        {/* SAYFA 1: PROFİL VE ÖZET */}
        <div className={pageClass}>
          {isModern ? (
            <div className="flex flex-col items-center text-center mb-6 bg-slate-800 text-white p-6 rounded-2xl shadow-md">
              <div className="w-24 h-24 mb-4 rounded-full border-2 border-slate-500 p-1 overflow-hidden bg-slate-700">
                 {photoData ? <PhotoRenderer className="w-full h-full object-cover rounded-full" /> : <ImageIcon className="w-8 h-8 text-slate-400 mx-auto mt-7" />}
              </div>
              <h1 className="text-2xl font-bold leading-tight">{personalInfo.fullName}</h1>
              <h2 className="text-sm font-medium text-blue-300 mt-1 uppercase tracking-wide">{personalInfo.title}</h2>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-4 text-[11px] text-slate-300">
                {String(personalInfo.contact || "").split('|').map((item, i) => <span key={i}>{item.trim()}</span>)}
              </div>
            </div>
          ) : isClassic ? (
            <div className="flex flex-col items-center text-center mb-8 border-b-2 border-slate-900 pb-6">
              <div className="w-24 h-24 mb-4 border border-slate-400 p-1 bg-white">
                 {photoData ? <PhotoRenderer className="w-full h-full object-cover" /> : null}
              </div>
              <h1 className="text-3xl font-bold uppercase tracking-widest">{personalInfo.fullName}</h1>
              <h2 className="text-sm italic mt-1">{personalInfo.title}</h2>
              <p className="text-[11px] mt-3 font-sans">{String(personalInfo.contact || "").replace(/\|/g, ' • ')}</p>
            </div>
          ) : isElegant ? (
            <div className="flex flex-col items-center text-center mb-10">
              <div className="w-28 h-28 mb-6 rounded-full border border-[#d4c5b9] p-1.5 shadow-sm">
                 {photoData ? <PhotoRenderer className="w-full h-full object-cover rounded-full" /> : <div className="w-full h-full bg-[#f3ede4] rounded-full"></div>}
              </div>
              <h1 className="text-3xl font-serif italic text-[#5d4d42] tracking-tight">{personalInfo.fullName}</h1>
              <h2 className="text-xs font-sans uppercase tracking-[0.2em] text-[#a69080] mt-2">{personalInfo.title}</h2>
              <div className="w-12 h-[1px] bg-[#d4c5b9] my-4"></div>
              <p className="text-[10px] font-sans text-[#8c7867] tracking-wide">{String(personalInfo.contact || "").replace(/\|/g, '  ·  ')}</p>
            </div>
          ) : isTechnical ? (
            <div className="flex flex-col mb-8 border-l-4 border-[#38bdf8] pl-6 py-2">
              <h1 className="text-3xl font-mono font-black text-white tracking-tighter">{personalInfo.fullName}</h1>
              <h2 className="text-sm font-mono text-[#38bdf8] mt-1">{`// ${personalInfo.title}`}</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-4 text-[10px] font-mono text-[#64748b]">
                {String(personalInfo.contact || "").split('|').map((item, i) => <div key={i} className="flex items-center gap-1"><span className="text-[#38bdf8] opacity-50">&gt;</span> {item.trim()}</div>)}
              </div>
            </div>
          ) : (
            // Minimal
            <div className="flex flex-row items-center gap-5 mb-8 border-b border-slate-100 pb-6">
               <div className="w-20 h-20 rounded-xl overflow-hidden shadow-sm flex-shrink-0">
                 {photoData ? <PhotoRenderer className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-100"></div>}
               </div>
               <div className="text-left">
                 <h1 className="text-2xl font-light tracking-tight text-slate-900">{personalInfo.fullName}</h1>
                 <h2 className="text-xs font-semibold text-slate-400 uppercase mt-1 tracking-widest">{personalInfo.title}</h2>
                 <div className="text-[10px] text-slate-400 mt-2 space-y-0.5">
                   {String(personalInfo.contact || "").split('|').map((item, i) => <div key={i}>{item.trim()}</div>)}
                 </div>
               </div>
            </div>
          )}

          {finalSummary && (
            <div className="mb-6 flex-shrink-0">
              <h3 className={headingClass}>{isTr ? 'Profil Özeti' : 'Profile Summary'}</h3>
              <p className={`text-[13px] leading-relaxed hyphens-auto ${isClassic ? 'font-serif' : ''}`}>
                {finalSummary}
              </p>
            </div>
          )}

          {finalSkills.length > 0 && (
            <div className="mt-auto">
              <h3 className={headingClass}>{isTr ? 'Yetenekler' : 'Skills'}</h3>
              <div className="flex flex-wrap gap-1.5">
                {finalSkills.map((s: string, i: number) => (
                  <span key={i} className={`${
                    isModern ? 'bg-white border border-slate-200 text-slate-700 shadow-sm px-2.5 py-1 rounded' :
                    isClassic ? 'border border-slate-400 px-2 py-0.5 text-slate-800' :
                    isElegant ? 'bg-[#f3ede4] text-[#5d4d42] px-2.5 py-1 rounded-full italic' :
                    isTechnical ? 'bg-[#1e293b] text-[#38bdf8] border border-[#38bdf8]/30 px-2 py-1 rounded font-mono' :
                    'text-slate-500 bg-slate-100 px-2 py-1 rounded-md'
                  } text-[11px] font-semibold`}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SAYFA 2: DENEYİMLER */}
        {finalExperiences.length > 0 && (
          <div className={pageClass}>
            <h3 className={`${headingClass} sticky top-0 z-10 ${isClassic ? 'bg-[#fdfbf7]' : isMinimal ? 'bg-white' : isElegant ? 'bg-[#faf7f2]' : isTechnical ? 'bg-[#0f172a]' : 'bg-slate-50'} pt-2`}>
              {isTr ? 'İş Deneyimi' : 'Experience'}
            </h3>
            <div className="space-y-6 pb-6">
              {finalExperiences.map((exp: any, i: number) => (
                <div key={i} className="relative">
                  <div className="mb-2">
                    <h4 className={`font-bold text-[14px] ${isTechnical ? 'text-white font-mono' : 'text-slate-900'}`}>{exp.title}</h4>
                    <div className={`text-[11px] mt-0.5 ${isModern ? 'text-blue-600 font-semibold' : isTechnical ? 'text-[#38bdf8] font-mono' : isElegant ? 'text-[#a69080] italic' : 'text-slate-500'}`}>
                      {exp.company} {exp.date && <span className={`${isClassic || isElegant ? 'italic font-normal' : 'text-slate-400 font-normal'}`}>| {exp.date}</span>}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {exp.finalDesc.map((desc: string, j: number) => (
                      <p key={j} className={`text-[12px] leading-relaxed pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[6px] before:w-1 before:h-1 before:rounded-full ${
                        isClassic || isElegant ? 'before:bg-slate-800' : isModern ? 'before:bg-blue-400' : isTechnical ? 'before:bg-[#38bdf8]' : 'before:bg-slate-300'
                      }`}>
                        {desc}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SAYFA 3: EĞİTİM VE DİĞER */}
        {(finalEducation.length > 0 || finalDynamics.length > 0) && (
          <div className={pageClass}>
            {finalEducation.length > 0 && (
              <div className="mb-8">
                <h3 className={headingClass}>{isTr ? 'Eğitim' : 'Education'}</h3>
                <div className="space-y-4">
                  {finalEducation.map((edu: any, i: number) => (
                    <div key={i}>
                      <h4 className={`font-bold text-[13px] ${isClassic ? 'text-slate-900' : 'text-slate-900'}`}>{edu.degree}</h4>
                      <p className="text-[12px] mt-0.5">{edu.school}</p>
                      {edu.date && <p className="text-[11px] opacity-70 mt-0.5">{edu.date}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {finalDynamics.map((sec: any, i: number) => (
              <div key={i} className="mb-6">
                <h3 className={headingClass}>{sec.title}</h3>
                <div className="space-y-2">
                  {sec.finalDesc.map((desc: string, j: number) => (
                    <p key={j} className={`text-[12px] leading-relaxed pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[6px] before:w-1 before:h-1 before:rounded-full ${
                      isClassic || isElegant ? 'before:bg-slate-800' : isModern ? 'before:bg-blue-400' : isTechnical ? 'before:bg-[#38bdf8]' : 'before:bg-slate-300'
                    }`}>
                      {desc}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );

    if (isExport) return <div className="flex flex-col bg-white">{content}</div>;
    return content;
  };

  const renderCoverLetter = (isExport: boolean = false) => {
    if (!analysisData || !analysisData.cover_letter) return null;
    const clText = activeLang === 'tr' ? analysisData.cover_letter.tr : analysisData.cover_letter.en;
    const isTr = activeLang === 'tr';
    const personalInfo = analysisData.cv[activeLang].personal_info || {};

    const paragraphs = clText.split('\n').filter((p: string) => p.trim() !== '');

    const isClassic = selectedTemplate === 'classic';
    const isMinimal = selectedTemplate === 'minimal';
    const isElegant = selectedTemplate === 'elegant';
    const isTechnical = selectedTemplate === 'technical';

    const pageClass = `${isExport ? 'w-[210mm] min-h-[297mm] mb-0 shadow-none' : 'w-full h-full snap-start snap-always flex-shrink-0 flex flex-col p-6 overflow-y-auto hide-scrollbar ios-scroll'} text-justify p-10 ${
      isClassic ? 'font-serif bg-[#fdfbf7] text-slate-900' : 
      isMinimal ? 'font-sans bg-white text-slate-600' : 
      isElegant ? 'font-serif bg-[#faf7f2] text-[#4a3f35]' :
      isTechnical ? 'font-mono bg-[#0f172a] text-[#94a3b8]' :
      'font-sans bg-slate-50 text-slate-800'
    }`;

    return (
      <div className={pageClass}>
         <div className={`border-b-2 pb-4 mb-6 ${isClassic ? 'border-slate-900' : isTechnical ? 'border-[#38bdf8]' : 'border-slate-200'}`}>
            <h1 className={`text-2xl font-bold ${isTechnical ? 'text-white' : ''}`}>{personalInfo.fullName}</h1>
            <h2 className={`text-sm opacity-70 font-medium ${isTechnical ? 'text-[#38bdf8]' : ''}`}>{personalInfo.title}</h2>
            <p className="text-[10px] opacity-60 mt-2">{String(personalInfo.contact || "").replace(/\|/g, '•')}</p>
         </div>

         <div className="flex-1 text-[13px] leading-loose space-y-4">
            {paragraphs.map((p: string, i: number) => (
               <p key={i}>{p}</p>
            ))}
         </div>

         <div className={`mt-8 pt-6 border-t ${isClassic ? 'border-slate-300' : isTechnical ? 'border-[#38bdf8]/30' : 'border-slate-200'}`}>
            <p className="text-[13px]">{isTr ? 'Saygılarımla,' : 'Sincerely,'}</p>
            <p className={`font-bold text-[14px] mt-2 ${isTechnical ? 'text-white' : ''}`}>{personalInfo.fullName}</p>
         </div>
      </div>
    );
  };

  // EKRAN: 3. AŞAMA - DİKEY KAYDIRMALI MOBİL CV GÖRÜNÜMÜ
  if (step === 'final') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col font-sans overflow-hidden">
        <header className="h-auto min-h-16 bg-slate-800 border-b border-slate-700 flex flex-wrap gap-3 justify-between items-center px-4 py-3 shadow-lg z-50 flex-shrink-0">
          <button onClick={() => setStep('review')} className="flex items-center gap-1 text-slate-300 hover:text-white text-sm font-bold transition-colors">
            <ArrowLeft className="w-4 h-4" /> Düzenle
          </button>
          
          <div className="flex bg-slate-700 rounded-lg p-1 overflow-x-auto hide-scrollbar">
            <button onClick={() => setActiveTab('cv')} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-bold transition-all ${activeTab === 'cv' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}>
               <FileText className="w-4 h-4" /> CV
            </button>
            <button onClick={() => setActiveTab('cover_letter')} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-bold transition-all ${activeTab === 'cover_letter' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}>
               <Mail className="w-4 h-4" /> Ön Yazı
            </button>
          </div>

          <div className="flex gap-2">
             <div className="flex bg-slate-700 rounded-lg p-1 overflow-x-auto hide-scrollbar max-w-[150px] sm:max-w-none">
               <button onClick={() => setSelectedTemplate('modern')} title="Modern" className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedTemplate === 'modern' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  M
               </button>
               <button onClick={() => setSelectedTemplate('classic')} title="Klasik" className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedTemplate === 'classic' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  C
               </button>
               <button onClick={() => setSelectedTemplate('minimal')} title="Minimal" className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedTemplate === 'minimal' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  Min
               </button>
               <button onClick={() => setSelectedTemplate('elegant')} title="Elegant" className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedTemplate === 'elegant' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  E
               </button>
               <button onClick={() => setSelectedTemplate('technical')} title="Technical" className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedTemplate === 'technical' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  T
               </button>
               <button onClick={() => setSelectedTemplate('professional')} title="Professional" className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all ${selectedTemplate === 'professional' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  P
               </button>
             </div>

             <div className="flex bg-slate-700 rounded-lg p-1">
               <button onClick={handleDownloadDocx} disabled={isExporting} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-all">
                  DOCX
               </button>
             </div>

             <div className="flex bg-slate-700 rounded-lg p-1">
               <button onClick={() => setActiveLang('tr')} className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-bold transition-all ${activeLang === 'tr' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  TR
               </button>
               <button onClick={() => setActiveLang('en')} className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-bold transition-all ${activeLang === 'en' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  EN
               </button>
             </div>
          </div>
        </header>

        <main className="flex-1 w-full flex justify-center items-center bg-slate-950 p-2 sm:p-8 relative">
           <div className="absolute top-4 left-1/2 -translate-x-1/2 text-slate-500 text-xs flex items-center gap-2 animate-pulse z-10 bg-slate-900/80 px-3 py-1 rounded-full pointer-events-none">
             Sayfaları değiştirmek için aşağı kaydırın ↓
           </div>

           {/* Hidden Export Container */}
           <div className="fixed top-[-9999px] left-[-9999px]">
             <div ref={exportRef} className="bg-white">
                {activeTab === 'cv' ? renderCV(true) : renderCoverLetter(true)}
             </div>
           </div>

           <div className="w-full max-w-[450px] max-h-[85vh] aspect-[9/16] bg-slate-100 rounded-[2rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] border-[8px] border-slate-800 overflow-hidden relative flex flex-col">
              <div className="w-full h-full overflow-y-auto snap-y snap-mandatory hide-scrollbar ios-scroll flex flex-col scroll-smooth">
                 {activeTab === 'cv' ? renderCV() : renderCoverLetter()}
              </div>
           </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg"><Sparkles className="w-6 h-6"/></div>
            <h1 className="text-xl font-bold hidden sm:block">Kariyer Koçu & CV Mülakatı</h1>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
            <span className={`px-2 py-1 rounded-full ${step === 'input' ? 'bg-blue-100 text-blue-700' : 'text-slate-400'}`}>1. Yükle</span>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span className={`px-2 py-1 rounded-full ${(step === 'generating_questions' || step === 'questionnaire') ? 'bg-blue-100 text-blue-700' : 'text-slate-400'}`}>2. Mülakat</span>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span className={`px-2 py-1 rounded-full ${(step === 'analyzing' || step === 'ats_report' || step === 'review') ? 'bg-blue-100 text-blue-700' : 'text-slate-400'}`}>3. Onayla</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {step === 'input' && (
            <motion.div 
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto space-y-6"
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">Mülakat ile CV'nizi Mükemmelleştirelim</h2>
                <p className="text-slate-500">Robot, sektörünüze özel kapalı uçlu mülakat soruları hazırlayıp CV'nizi ve Ön Yazınızı detaylandıracak.</p>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-4 mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex-shrink-0 w-16 h-16 rounded-full bg-slate-200 border-2 border-dashed border-slate-400 flex items-center justify-center overflow-hidden cursor-pointer" onClick={() => photoInputRef.current?.click()}>
                    {photoData ? <img src={photoData} alt="Vesikalık" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <ImageIcon className="w-6 h-6 text-slate-400" />}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-700 text-sm">Vesikalık Fotoğraf</h3>
                    <input type="file" ref={photoInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
                    <button onClick={() => photoInputRef.current?.click()} className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full hover:bg-blue-100 mt-2">Fotoğraf Seç</button>
                  </div>
                </div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Hedef Pozisyon / Sektör</label>
                <input type="text" value={targetJob} onChange={(e) => setTargetJob(e.target.value)} placeholder="Örn: Muhasebe Uzmanı, Yazılım Geliştirici..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-6" />
                <label className="block text-sm font-bold text-slate-700 mb-2">CV Dosyanız (Veya Resmi)</label>
                <div className="border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-slate-50 rounded-xl p-6 text-center cursor-pointer transition-colors mb-4" onClick={() => fileInputRef.current?.click()}>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf,.txt,image/*" className="hidden" />
                  <UploadCloud className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                  <p className="text-sm font-medium text-slate-700">PDF, TXT veya JPG seçmek için tıklayın</p>
                </div>
                {pdfData && (
                  <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-lg mb-4 border border-indigo-100">
                    <div className="flex items-center gap-2 text-indigo-700 font-medium"><FileIcon className="w-5 h-5"/> {pdfData.name}</div>
                    <button onClick={() => setPdfData(null)} className="text-red-500 text-sm hover:underline font-medium">Kaldır</button>
                  </div>
                )}
                {error && <div className="mt-4 p-4 text-sm text-red-700 bg-red-50 rounded-xl flex items-start gap-3"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> <p>{error}</p></div>}
                <button onClick={handleGenerateQuestions} className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg transition-transform active:scale-95 flex justify-center items-center gap-2">
                  <ClipboardList className="w-5 h-5" /> Sektörel Mülakatı Başlat
                </button>
              </div>
            </motion.div>
          )}

          {step === 'generating_questions' && (
            <motion.div 
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <Loader2 className="w-16 h-16 text-blue-600 mb-6 animate-spin" />
              <h2 className="text-2xl font-bold text-slate-800 text-center">Tüm Tecrübeleriniz Taranıyor...</h2>
              <p className="text-slate-500 mt-3 max-w-md text-center">Eksiksiz şekilde kapalı uçlu (Evet/Hayır) mülakat soruları hazırlanıyor...</p>
            </motion.div>
          )}

          {step === 'questionnaire' && (
            <motion.div 
              key="questionnaire"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-lg mb-6">
                <h2 className="text-2xl font-bold mb-2 flex items-center gap-2"><ClipboardList className="w-7 h-7"/> CV Zenginleştirme Mülakatı</h2>
                <p className="text-indigo-100 leading-relaxed">Aşağıdaki kapalı uçlu soruları geçmiş tecrübelerinize göre "Yaptım Evet" veya "Yapmadım Hayır" olarak işaretleyin ve hangi şirketlerde yaptığınızı seçin.</p>
              </div>
              
              <div className="space-y-4">
                {interviewData.questions.map((q: any, idx: number) => {
                  const isDone = userAnswers[q.id]?.done;
                  const selectedExpIds = userAnswers[q.id]?.expIds || [];
                  
                  return (
                    <div key={q.id} className={`bg-white rounded-xl p-5 border-2 transition-colors flex flex-col gap-4 ${isDone === true ? 'border-green-500 shadow-md' : isDone === false ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <p className="text-slate-800 font-medium text-sm md:text-base leading-snug pr-4 text-justify">{idx + 1}. {q.text}</p>
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => handleAnswerChange(q.id, true)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${isDone === true ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>✓ Yaptım Evet</button>
                          <button onClick={() => handleAnswerChange(q.id, false)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${isDone === false ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>✗ Yapmadım Hayır</button>
                        </div>
                      </div>
                      {isDone && (
                        <div className="pt-3 border-t border-slate-100">
                          <span className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Hangi Tecrübelerinizde Yaptınız?</span>
                          <div className="flex flex-wrap gap-2">
                            {interviewData.experiences.map((exp: any) => {
                              const isSelected = selectedExpIds.includes(exp.id);
                              return (
                                <button key={exp.id} onClick={() => toggleExperienceForQuestion(q.id, exp.id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                  {isSelected && "✓ "} {exp.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              <div className="mt-10 mb-20 text-center border-t border-slate-200 pt-8">
                <button onClick={handleAnalyzeAndBuild} className="bg-slate-900 hover:bg-slate-800 text-white text-lg font-bold py-4 px-12 rounded-xl shadow-xl transition-transform active:scale-95 flex items-center gap-2 mx-auto">
                  Mülakatı Bitir ve Analize Geç <ChevronRight className="w-5 h-5"/>
                </button>
              </div>
            </motion.div>
          )}

          {step === 'analyzing' && (
            <motion.div 
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <Loader2 className="w-16 h-16 text-blue-600 mb-6 animate-spin" />
              <h2 className="text-2xl font-bold text-slate-800 text-center">Tasarım İnşa Ediliyor...</h2>
              <p className="text-slate-500 mt-3 max-w-md text-center">Ön Yazı hazırlanıyor ve hiçbir bilgi kısaltılmadan detaylı olarak yerleştiriliyor...</p>
            </motion.div>
          )}

          {step === 'ats_report' && analysisData && (
            <motion.div 
              key="ats_report"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 text-white text-center">
                  <div className="inline-flex p-3 bg-blue-500/20 rounded-2xl mb-4">
                    <Sparkles className="w-8 h-8 text-blue-400" />
                  </div>
                  <h2 className="text-3xl font-bold mb-2">ATS Analiz Raporu</h2>
                  <p className="text-slate-400">CV'nizin taranabilirlik ve işe alım sistemlerine uyumluluk analizi tamamlandı.</p>
                </div>

                <div className="p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
                    <div className="flex flex-col items-center text-center p-8 rounded-3xl bg-slate-50 border border-slate-100">
                      <span className="text-sm font-bold uppercase text-slate-400 mb-6 tracking-widest">Eski CV Skoru</span>
                      <div className="relative w-40 h-40 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-200" />
                          <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={439.8} strokeDashoffset={439.8 - (439.8 * (analysisData.ats_score_original || 0)) / 100} className="text-red-500 transition-all duration-1000" />
                        </svg>
                        <span className="absolute text-4xl font-black text-slate-800">{analysisData.ats_score_original || 0}%</span>
                      </div>
                      <p className="mt-6 text-sm text-slate-500 leading-relaxed">Mevcut CV'nizin anahtar kelime eksiklikleri ve format hataları nedeniyle elenme riski yüksekti.</p>
                    </div>

                    <div className="flex flex-col items-center text-center p-8 rounded-3xl bg-blue-50 border border-blue-100">
                      <span className="text-sm font-bold uppercase text-blue-600 mb-6 tracking-widest">Yeni CV Skoru</span>
                      <div className="relative w-40 h-40 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-blue-100" />
                          <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={439.8} strokeDashoffset={439.8 - (439.8 * (analysisData.ats_score_proposed || 0)) / 100} className="text-blue-600 transition-all duration-1000" />
                        </svg>
                        <span className="absolute text-4xl font-black text-blue-700">{analysisData.ats_score_proposed || 0}%</span>
                      </div>
                      <p className="mt-6 text-sm text-blue-700/70 leading-relaxed font-medium">Yapay zeka ile zenginleştirilen yeni CV'niz, ATS sistemlerinden geçmek için optimize edildi.</p>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-2xl p-6 text-white flex items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-green-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg">İyileştirme Tamamlandı</h4>
                        <p className="text-slate-400 text-sm">Tüm deneyimleriniz ATS dostu anahtar kelimelerle güncellendi.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setStep('review')}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-bold shadow-lg shadow-blue-600/20 transition-all active:scale-95 flex items-center gap-2"
                    >
                      Sonuçları Görüntüle <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'review' && analysisData && analysisData.cv && analysisData.cv.tr && (
            <motion.div 
              key="review"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg mb-8">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2"><CheckCircle2 className="w-6 h-6"/> İçerik Üretildi! (Türkçe Revizyon)</h2>
                <p className="text-blue-100 leading-relaxed mb-4 text-justify">{analysisData.general_review}</p>
              </div>
              
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200"><h4 className="font-bold text-lg text-slate-800">Profesyonel Özet</h4></div>
                  <div className="p-6 grid md:grid-cols-2 gap-6">
                    <div>
                      <span className="text-xs font-bold uppercase text-slate-400">Mevcut</span>
                      <p className="mt-1 text-sm text-slate-600 bg-slate-50 p-3 rounded-lg mb-4 text-justify">{analysisData.cv.tr.summary.original}</p>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex-grow">
                        <span className="text-xs font-bold uppercase text-green-600">Önerilen</span>
                        <p className="mt-1 text-sm text-slate-800 bg-green-50 p-4 rounded-lg font-medium text-justify">{analysisData.cv.tr.summary.proposed}</p>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button onClick={() => setSelectionValue('summary', null, true)} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${selections.summary ? 'bg-green-600 text-white' : 'bg-white text-slate-500'}`}>Öneriyi Kullan</button>
                        <button onClick={() => setSelectionValue('summary', null, false)} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${!selections.summary ? 'bg-slate-700 text-white' : 'bg-white text-slate-500'}`}>Eskiyi Koru</button>
                      </div>
                    </div>
                  </div>
                </div>

                {safeArray(analysisData.cv.tr.experiences).map((exp: any) => (
                  <div key={exp.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200"><h4 className="font-bold text-lg text-slate-800">Deneyim: {exp.title}</h4></div>
                    <div className="p-6 grid md:grid-cols-2 gap-6">
                      <div>
                        <span className="text-xs font-bold uppercase text-slate-400">Mevcut</span>
                        <p className="mt-1 text-sm text-slate-600 bg-slate-50 p-3 rounded-lg mb-4 whitespace-pre-wrap text-justify">{exp.original_desc}</p>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex-grow">
                          <span className="text-xs font-bold uppercase text-green-600">Önerilen (Mülakat Verileriyle Detaylı)</span>
                          <ul className="mt-1 text-sm text-slate-800 bg-green-50 p-4 rounded-lg list-disc list-inside space-y-2 border border-green-200 text-justify">
                            {safeArray(exp.proposed_achievements).map((ach: string, idx: number) => <li key={idx}>{ach}</li>)}
                          </ul>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button onClick={() => setSelectionValue('experiences', exp.id, true)} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${selections.experiences[exp.id] ? 'bg-green-600 text-white' : 'bg-white text-slate-500'}`}>Öneriyi Kullan</button>
                          <button onClick={() => setSelectionValue('experiences', exp.id, false)} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${!selections.experiences[exp.id] ? 'bg-slate-700 text-white' : 'bg-white text-slate-500'}`}>Eskiyi Koru</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10 mb-20 text-center border-t border-slate-200 pt-8">
                <button onClick={() => setStep('final')} className="bg-slate-900 hover:bg-slate-800 text-white text-lg font-bold py-4 px-12 rounded-xl shadow-xl transition-transform active:scale-95 flex items-center gap-2 mx-auto">
                  Sonucu Görüntüle <ChevronRight className="w-5 h-5"/>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
