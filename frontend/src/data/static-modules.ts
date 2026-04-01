/**
 * Bundled static module data for Phase 1 instant loading
 * These are loaded into localStorage on first visit
 */

import type { StaticModule } from '../services/localstorage-manager';

export const staticData: Record<StaticModule, Record<string, unknown>> = {
  drugs: {
    _meta: { name: 'Common NCLEX Drugs', version: 1, count: 50 },
    metformin: { class: 'Biguanide', use: 'Type 2 DM', monitoring: 'Renal function, B12', contraindications: 'eGFR < 30', side_effects: ['GI upset', 'Lactic acidosis (rare)'], nclex_tip: 'Hold before contrast dye procedures' },
    lisinopril: { class: 'ACE Inhibitor', use: 'HTN, HF, Diabetic nephropathy', monitoring: 'K+, Renal function, BP', contraindications: 'Pregnancy, Angioedema hx', side_effects: ['Dry cough', 'Hyperkalemia', 'Angioedema'], nclex_tip: 'Dry cough is expected; switch to ARB if intolerable' },
    warfarin: { class: 'Anticoagulant', use: 'DVT/PE, A-fib, Valve replacement', monitoring: 'INR (target 2-3)', antidote: 'Vitamin K, FFP', interactions: ['Leafy greens (Vit K)', 'Many drug interactions'], nclex_tip: 'Consistent vitamin K diet; INR 2-3 for most; 2.5-3.5 for mechanical valves' },
    digoxin: { class: 'Cardiac Glycoside', use: 'HF, A-fib', monitoring: 'Dig level (0.8-2 ng/mL), K+, HR', toxicity_signs: ['N/V', 'Visual changes (yellow-green halos)', 'Bradycardia'], nclex_tip: 'Hold if HR < 60; hypokalemia increases toxicity risk' },
    heparin: { class: 'Anticoagulant', use: 'DVT/PE prevention/treatment', monitoring: 'aPTT (1.5-2.5x control)', antidote: 'Protamine sulfate', nclex_tip: 'Never rub injection site; rotate abdomen sites' },
    insulin_regular: { class: 'Rapid-acting Insulin', onset: '30-60 min', peak: '2-4 hrs', duration: '6-8 hrs', nclex_tip: 'Only insulin given IV; draw up regular before NPH' },
    furosemide: { class: 'Loop Diuretic', use: 'HF, Edema, HTN', monitoring: 'K+, Na+, Hearing, BP', side_effects: ['Hypokalemia', 'Ototoxicity', 'Dehydration'], nclex_tip: 'Give in AM to prevent nocturia; monitor K+' },
    morphine: { class: 'Opioid Analgesic', use: 'Severe pain, MI, Pulmonary edema', monitoring: 'RR, BP, Pain level, Sedation', antidote: 'Naloxone', nclex_tip: 'Hold if RR < 12; have naloxone available' },
    levothyroxine: { class: 'Thyroid Hormone', use: 'Hypothyroidism', monitoring: 'TSH, T3/T4', administration: 'Empty stomach, AM, 30-60 min before food', nclex_tip: 'Separate from calcium/iron by 4 hours' },
    potassium_chloride: { class: 'Electrolyte Supplement', use: 'Hypokalemia', max_iv_rate: '10 mEq/hr', monitoring: 'K+ level, ECG, Renal function', nclex_tip: 'NEVER give IV push; dilute and infuse slowly; burns on infusion' },
  },

  labs: {
    _meta: { name: 'Critical Lab Values', version: 1 },
    sodium: { normal: '136-145 mEq/L', critical_low: '<120', critical_high: '>160', unit: 'mEq/L' },
    potassium: { normal: '3.5-5.0 mEq/L', critical_low: '<2.5', critical_high: '>6.5', unit: 'mEq/L' },
    calcium: { normal: '9.0-10.5 mg/dL', critical_low: '<6.0', critical_high: '>13.0', unit: 'mg/dL' },
    magnesium: { normal: '1.3-2.1 mEq/L', critical_low: '<1.0', critical_high: '>4.7', unit: 'mEq/L' },
    glucose: { normal: '70-100 mg/dL', critical_low: '<40', critical_high: '>400', unit: 'mg/dL' },
    BUN: { normal: '10-20 mg/dL', unit: 'mg/dL' },
    creatinine: { normal: '0.7-1.3 mg/dL', unit: 'mg/dL' },
    WBC: { normal: '5000-10000/mcL', unit: '/mcL' },
    hemoglobin: { male: '14-18 g/dL', female: '12-16 g/dL', unit: 'g/dL' },
    hematocrit: { male: '42-52%', female: '37-47%', unit: '%' },
    platelets: { normal: '150000-400000/mcL', critical_low: '<50000', unit: '/mcL' },
    INR: { normal: '0.8-1.1', therapeutic_warfarin: '2.0-3.0', mechanical_valve: '2.5-3.5' },
    aPTT: { normal: '30-40 sec', therapeutic_heparin: '1.5-2.5x control' },
    PT: { normal: '11-12.5 sec', unit: 'sec' },
    troponin: { normal: '<0.04 ng/mL', elevated: '>0.4 suggests MI', unit: 'ng/mL' },
    BNP: { normal: '<100 pg/mL', hf_likely: '>400', unit: 'pg/mL' },
    HbA1c: { normal: '<5.7%', prediabetes: '5.7-6.4%', diabetes: '>6.5%' },
    ABG_pH: { normal: '7.35-7.45', acidosis: '<7.35', alkalosis: '>7.45' },
    ABG_PaCO2: { normal: '35-45 mmHg', unit: 'mmHg' },
    ABG_HCO3: { normal: '22-26 mEq/L', unit: 'mEq/L' },
    ABG_PaO2: { normal: '80-100 mmHg', unit: 'mmHg' },
  },

  formulas: {
    _meta: { name: 'NCLEX Calculation Formulas', version: 1 },
    iv_drip_rate: { formula: '(Volume mL / Time min) × Drop factor', example: '(1000 / 480) × 15 = 31.25 gtt/min' },
    iv_flow_rate: { formula: 'Volume mL / Time hrs', example: '1000 mL / 8 hrs = 125 mL/hr' },
    dosage_weight: { formula: '(Desired dose mg/kg × Weight kg)', example: '5 mg/kg × 70 kg = 350 mg' },
    desired_over_have: { formula: '(Desired / Have) × Vehicle', example: '(500 / 250) × 1 tab = 2 tabs' },
    intake_output: { formula: 'Total intake - Total output = Fluid balance', notes: 'Include IV, PO, tube feeds as intake; urine, drainage, emesis as output' },
    bmi: { formula: '(Weight kg) / (Height m)²', normal: '18.5-24.9' },
    map: { formula: '(SBP + 2×DBP) / 3', normal: '70-105 mmHg' },
  },

  strategies: {
    _meta: { name: 'NCLEX Test-Taking Strategies', version: 1 },
    abc: { name: 'ABCs Priority', rule: 'Airway > Breathing > Circulation', when: 'Prioritization questions' },
    maslow: { name: 'Maslow Hierarchy', rule: 'Physiological > Safety > Love > Esteem > Self-actualization', when: 'When ABCs don\'t apply' },
    nursing_process: { name: 'Nursing Process', steps: ['Assessment', 'Diagnosis', 'Planning', 'Implementation', 'Evaluation'], rule: 'Assess before you act' },
    safety: { name: 'Patient Safety First', rule: 'Choose the answer that keeps the patient safest' },
    delegation: { name: 'Delegation Rules', rule: 'RN: Assess, Plan, Evaluate, Teach. LPN: Stable, predictable, established plan. UAP: ADLs, vitals, ambulation' },
    therapeutic_communication: { name: 'Therapeutic Communication', do: ['Open-ended questions', 'Reflection', 'Clarification', 'Silence'], avoid: ['Why questions', 'False reassurance', 'Giving advice', 'Changing subject'] },
  },

  delegation: {
    _meta: { name: 'Delegation & Scope of Practice', version: 1 },
    rn_scope: { can: ['Assessment', 'Care planning', 'Evaluation', 'Patient teaching', 'IV push meds', 'Blood administration', 'Unstable patients'], cannot_delegate: ['Initial assessment', 'Care plan development', 'Evaluation of outcomes'] },
    lpn_scope: { can: ['Stable patients', 'Routine care', 'Oral/IM meds', 'Dressing changes', 'Suctioning', 'Catheter care', 'Tube feedings'], with_training: ['IV monitoring (not initiation)', 'Tracheostomy care'] },
    uap_scope: { can: ['ADLs (bathing, feeding, grooming)', 'Vital signs on stable patients', 'Ambulation', 'I&O measurement', 'Specimen collection', 'CPM machine', 'Turning/repositioning'], cannot: ['Any nursing judgment', 'Assessment', 'Teaching', 'Medication administration'] },
    five_rights: { rights: ['Right task', 'Right circumstance', 'Right person', 'Right direction/communication', 'Right supervision/evaluation'] },
  },

  communication: {
    _meta: { name: 'Therapeutic Communication', version: 1 },
    therapeutic: { techniques: ['Active listening', 'Open-ended questions', 'Reflection', 'Restating', 'Clarification', 'Silence', 'Summarizing', 'Focusing', 'Offering self', 'Exploring'] },
    non_therapeutic: { techniques: ['Giving false reassurance', 'Giving advice', 'Asking why', 'Changing subject', 'Agreeing/disagreeing', 'Belittling feelings', 'Defending', 'Probing', 'Rejecting', 'Stereotyping'] },
    sbar: { S: 'Situation - What is happening?', B: 'Background - What is the context?', A: 'Assessment - What do I think the problem is?', R: 'Recommendation - What should we do?' },
  },

  diagnostics: {
    _meta: { name: 'Diagnostic Tests & Procedures', version: 1 },
    cardiac_cath: { prep: 'NPO 6-8hrs, assess allergies (contrast dye), mark peripheral pulses', post: 'Bed rest 4-6hrs, pressure on site, monitor VS & pulses q15min, assess for bleeding' },
    ct_with_contrast: { prep: 'Assess iodine/shellfish allergy, check creatinine, hold metformin 48hrs', post: 'Push fluids, monitor renal function' },
    mri: { prep: 'Remove all metal, assess for implants/pacemaker', contraindications: ['Pacemaker', 'Metal implants', 'Cochlear implants'] },
    lumbar_puncture: { position: 'Fetal position or sitting leaning forward', post: 'Flat 4-8hrs, push fluids, monitor for headache' },
    bronchoscopy: { prep: 'NPO 6-8hrs, remove dentures', post: 'NPO until gag reflex returns, semi-Fowlers, monitor for bleeding' },
    paracentesis: { prep: 'Empty bladder, baseline weight/girth', post: 'Monitor VS, measure drainage, daily weight' },
    thoracentesis: { position: 'Sitting upright leaning forward', post: 'Chest X-ray to rule out pneumothorax, monitor breathing' },
  },

  health_equity: {
    _meta: { name: 'Health Equity & Cultural Considerations', version: 1 },
    principles: ['Cultural humility over cultural competence', 'Ask patients about their preferences', 'Use professional interpreters (not family members)', 'Respect health beliefs while ensuring safety', 'Address social determinants of health'],
    social_determinants: ['Economic stability', 'Education access', 'Healthcare access', 'Neighborhood/environment', 'Social/community context'],
    health_literacy: { assess: 'Teach-back method', strategies: ['Use plain language', 'Visual aids', 'Chunk information', 'Confirm understanding'] },
  },

  development: {
    _meta: { name: 'Growth & Development Milestones', version: 1 },
    erikson: {
      'infant_0-1': { stage: 'Trust vs Mistrust', focus: 'Consistent caregiving' },
      'toddler_1-3': { stage: 'Autonomy vs Shame/Doubt', focus: 'Independence, choices' },
      'preschool_3-6': { stage: 'Initiative vs Guilt', focus: 'Purpose, exploration' },
      'school_6-12': { stage: 'Industry vs Inferiority', focus: 'Competence, achievement' },
      'adolescent_12-18': { stage: 'Identity vs Role Confusion', focus: 'Self-identity' },
      'young_adult': { stage: 'Intimacy vs Isolation', focus: 'Relationships' },
      'middle_adult': { stage: 'Generativity vs Stagnation', focus: 'Contributing to society' },
      'older_adult': { stage: 'Integrity vs Despair', focus: 'Life reflection' },
    },
    piaget: {
      'sensorimotor_0-2': { key: 'Object permanence', learning: 'Senses and motor activity' },
      'preoperational_2-7': { key: 'Egocentrism, magical thinking', learning: 'Symbolic play' },
      'concrete_7-11': { key: 'Conservation, logical thinking', learning: 'Concrete objects' },
      'formal_11+': { key: 'Abstract thinking', learning: 'Hypothetical reasoning' },
    },
  },

  infection_control: {
    _meta: { name: 'Infection Control & Precautions', version: 1 },
    standard: { applies: 'ALL patients', components: ['Hand hygiene', 'PPE as needed', 'Safe injection practices', 'Respiratory hygiene'] },
    contact: { ppe: ['Gown', 'Gloves'], examples: ['MRSA', 'VRE', 'C. diff', 'Scabies', 'Wound infections'], room: 'Private or cohort' },
    droplet: { ppe: ['Surgical mask within 3 feet'], examples: ['Influenza', 'Pertussis', 'Meningitis (bacterial)', 'Mumps', 'Rubella'], room: 'Private, door can be open' },
    airborne: { ppe: ['N95 respirator'], examples: ['TB', 'Measles', 'Varicella', 'COVID-19'], room: 'Negative pressure, door closed' },
    neutropenic: { precautions: ['Private room', 'No fresh flowers/fruit', 'Low-bacteria diet', 'Strict hand hygiene', 'Avoid crowds'] },
  },

  drug_suffixes: {
    _meta: { name: 'Drug Name Suffix Guide', version: 1 },
    '-olol': { class: 'Beta Blockers', examples: ['metoprolol', 'atenolol', 'propranolol'] },
    '-pril': { class: 'ACE Inhibitors', examples: ['lisinopril', 'enalapril', 'captopril'] },
    '-sartan': { class: 'ARBs', examples: ['losartan', 'valsartan', 'irbesartan'] },
    '-statin': { class: 'HMG-CoA Reductase Inhibitors', examples: ['atorvastatin', 'simvastatin', 'rosuvastatin'] },
    '-prazole': { class: 'Proton Pump Inhibitors', examples: ['omeprazole', 'pantoprazole', 'esomeprazole'] },
    '-tidine': { class: 'H2 Blockers', examples: ['famotidine', 'ranitidine'] },
    '-mycin': { class: 'Macrolide Antibiotics', examples: ['azithromycin', 'erythromycin', 'clarithromycin'] },
    '-cillin': { class: 'Penicillins', examples: ['amoxicillin', 'ampicillin'] },
    '-caine': { class: 'Local Anesthetics', examples: ['lidocaine', 'bupivacaine'] },
    '-dipine': { class: 'Calcium Channel Blockers (DHP)', examples: ['amlodipine', 'nifedipine'] },
    '-lam/-pam': { class: 'Benzodiazepines', examples: ['lorazepam', 'diazepam', 'midazolam'] },
    '-pine/-done': { class: 'Atypical Antipsychotics', examples: ['olanzapine', 'quetiapine', 'risperidone'] },
    '-oxacin': { class: 'Fluoroquinolones', examples: ['ciprofloxacin', 'levofloxacin'] },
  },

  herbals: {
    _meta: { name: 'Herbal Supplements & Interactions', version: 1 },
    st_johns_wort: { use: 'Depression', interactions: ['Reduces effectiveness of many drugs', 'SSRIs (serotonin syndrome)', 'Oral contraceptives', 'Warfarin', 'Cyclosporine'] },
    ginkgo: { use: 'Memory, circulation', risk: 'Increased bleeding', interactions: ['Anticoagulants', 'Antiplatelet drugs', 'NSAIDs'] },
    garlic: { use: 'Cholesterol, BP', risk: 'Increased bleeding', interactions: ['Anticoagulants', 'Antihypertensives'] },
    ginger: { use: 'Nausea, motion sickness', risk: 'Increased bleeding at high doses', interactions: ['Anticoagulants'] },
    echinacea: { use: 'Immune support', risk: 'Hepatotoxicity with prolonged use', contraindications: ['Autoimmune diseases', 'Immunosuppressive therapy'] },
    kava: { use: 'Anxiety', risk: 'Hepatotoxicity', interactions: ['CNS depressants', 'Alcohol', 'Benzodiazepines'] },
    valerian: { use: 'Insomnia, anxiety', interactions: ['CNS depressants', 'Alcohol'] },
  },

  iv_fluids: {
    _meta: { name: 'IV Fluid Types & Uses', version: 1 },
    isotonic: {
      'NS_0.9': { osmolarity: 308, use: 'Volume replacement, blood transfusions, metabolic alkalosis', caution: 'Fluid overload in HF' },
      'LR': { osmolarity: 273, use: 'Burns, GI losses, surgery', caution: 'Contains K+ - avoid in renal failure; contains lactate - avoid in liver failure' },
      'D5W': { osmolarity: 252, use: 'Vehicle for IV meds, provides free water', note: 'Isotonic in bag but becomes hypotonic in body' },
    },
    hypotonic: {
      '0.45NS': { osmolarity: 154, use: 'Cellular dehydration, DKA (after initial NS)', caution: 'Can cause cellular edema; never in head injury (ICP increase)' },
    },
    hypertonic: {
      'D5_0.45NS': { osmolarity: 406, use: 'Daily maintenance with calories', caution: 'Monitor blood glucose' },
      '3_NaCl': { osmolarity: 1026, use: 'Severe hyponatremia, cerebral edema', caution: 'Administer via pump; monitor Na+ closely; risk of fluid overload' },
    },
    colloids: {
      albumin: { use: 'Volume expansion, burns, liver failure', note: 'Draws fluid into vascular space' },
    },
  },

  vaccines: {
    _meta: { name: 'Immunization Schedule Essentials', version: 1 },
    live_vaccines: { vaccines: ['MMR', 'Varicella', 'Rotavirus', 'Intranasal flu (FluMist)', 'BCG', 'Yellow fever'], rules: ['Contraindicated in pregnancy', 'Contraindicated in immunocompromised', 'Give all live vaccines same day or wait 28 days'] },
    inactivated_vaccines: { vaccines: ['DTaP/Tdap', 'IPV', 'Hep A', 'Hep B', 'Influenza (injection)', 'Pneumococcal', 'HPV', 'Meningococcal'], rules: ['Can be given at any interval', 'Safe in immunocompromised'] },
    nclex_rules: ['Check for egg allergy (flu vaccine)', 'Check for gelatin/neomycin allergy (MMR, Varicella)', 'Withhold live vaccines if on immunosuppressants', 'Pregnancy: give Tdap (27-36 weeks), flu; avoid live vaccines'] },
  },
};
