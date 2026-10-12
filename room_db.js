/* ============================================================
   room_db.js — 在籍作成ルーム：Supabase とのやりとり（内勤・キャスト共通）
   ------------------------------------------------------------
   今までの GAS と同じ「action 名・返事の形」のまま、中身だけ Supabase にした。
   画面は fetch(GAS_URL, …) のかわりに roomFetch(GAS_URL, …) を呼ぶだけ（返事の読み方は同じ）。

   ・内勤（staff.html）：ポータルのログイン（naikin@…・20時間）をそのまま使う
   ・キャスト（index.html）：ログインなし。ルームの記号（URLの id）で、自分のルームだけ読み書きできる
   ・写真は Supabase の写真置き場（room-photos）に入れる（今までの写真は Google ドライブのまま見られる）
   ・キャストが編集すると、内勤にメールが届く（Supabase 側で順番待ちに入れる）
   ============================================================ */
(function(){
  const SUPABASE_URL = "https://tuxqpqokbvkrckgxcfdn.supabase.co";
  const SUPABASE_KEY = "sb_publishable_PyvCZHSzYlaqauYbdZybng_zbftghak";
  const STAFF_EMAIL = 'naikin@sakuramoong.internal';
  const STAFF_HOURS = 20;
  const BUCKET = 'room-photos';
  const COSTUME_MAX_SLOTS = 8;

  // ---------- ここから下の項目一覧は、今までの GAS（コード.gs）からそのまま写したもの ----------
// チェックリストの初期状態（キー: 項目, value: { done: false, by: '', at: '' }）
// owner: 'cast'（キャストが操作・キャストに見える） / 'staff'（内勤が操作・キャストにも進捗が見える） / 'staffOnly'（内勤専用、キャストには一切見せない）
const CHECKLIST_ITEMS = {
  // 内勤専用（キャストには一切見せない）
  inkanReceived:   { label: '印鑑', owner: 'staffOnly' },
  idCopyReceived:  { label: '公的証明書コピー', owner: 'staffOnly' },
  locationReceived:{ label: '待機場所画像送信【★共有面接フォルダ→面接後キャストへ送るフォルダ】', owner: 'staffOnly' },
  postingReceived: { label: 'ポスティング方法送信【★共有面接フォルダ→面接後キャストへ送るフォルダ】', owner: 'staffOnly' },
  bannerProposed:  { label: 'ビジュ良い子なら新人バナーを提案する', owner: 'staffOnly' },
  bannerMade:      { label: '新人バナー作成済み（新人バナー提案した場合）', owner: 'staffOnly' },
  recordBookEntry: { label: '記録簿当月+元データバック入力', owner: 'staffOnly' },
  backListFilled:  { label: '新バック一覧情報埋め込み', owner: 'staffOnly' },
  costumeApproved: { label: '撮影衣装チェック', owner: 'staffOnly' },
  studioBooked:    { label: '撮影予約+撮影詳細送信【スタジオ関連フォルダ】', owner: 'staffOnly' },
  studioDone:      { label: 'スタジオ撮影完了', owner: 'staffOnly' },
  selection:              { label: '選定', owner: 'staffOnly' },
  retouchRequested:       { label: 'レタッチ依頼', owner: 'staffOnly' },
  resizeDone:             { label: '修正済みリサイズ', owner: 'staffOnly' },
  officialProfileFilled:  { label: '公式HPプロフィール内容埋める', owner: 'staffOnly' },
  officialSlotCreated:    { label: '公式HP在籍枠作成', owner: 'staffOnly' },
  castUpRegistered:       { label: 'キャストアップ登録', owner: 'staffOnly' },
  officialPosted:         { label: '公式掲載', owner: 'staffOnly' },
  officialNewInfoReflected: { label: '公式HP新人情報反映', owner: 'staffOnly' },
  mailMagazineScheduled:  { label: '公式メルマガ新人情報予約', owner: 'staffOnly' },
  recommendUpdated:       { label: '良い子だったら媒体の店長お勧め更新', owner: 'staffOnly' },
  photoUploaded:          { label: '写真アップロード', owner: 'staffOnly' },
  mediaReflected:         { label: '媒体反映', owner: 'staffOnly' },
  mediaReflectedChecked:  { label: '媒体反映確認', owner: 'staffOnly' },
  shiftAppCreated: { label: 'シフト内勤管理アプリから新規作成', owner: 'staffOnly' },
  shiftAppLineSent:{ label: 'シフト内勤管理アプリからLINEでアプリページ送信', owner: 'staffOnly' },
  firstShiftDecided: { label: '初出勤決定（必ず金土含む日をスタートに）', owner: 'staffOnly' },
  diaryPracticeSent:{ label: '写メ日記練習依頼', owner: 'staffOnly' },
  diaryFirstPost:  { label: '写メ日記・姫デコ登録', owner: 'staffOnly' },
  diaryReflectRequest: { label: '本番反映OKそうなら投稿依頼', owner: 'staffOnly' },
  diaryMediaChecked:   { label: '写メ日記 各媒体反映確認', owner: 'staffOnly' },
  diaryWidgetEmbedded:   { label: '写メ日記ウィジェット埋め込み', owner: 'staffOnly' },

  // キャストにも表示されるが、チェックは内勤だけが行う（キャストはクリック不可・進捗閲覧のみ）
  guideReadByCast: { label: '新人ガイド既読', owner: 'staffCheck' },
  roadmapReadByCast:{ label: '姫デコロードマップ既読', owner: 'staffCheck' },
  profileSubmitted:{ label: '在籍プロフィール入力フォーム入力', owner: 'staffCheck' },
  emailProvided:   { label: 'メールアドレス保存', owner: 'staffCheck' },
  costumeUploaded: { label: '衣装・靴・ウィッグ（または地毛の相談）の写真をアップロード', owner: 'staffCheck' },

  // キャストが選ぶ項目（キャストが操作、内勤は結果を閲覧）
  kitChosen:       { label: 'お仕事セットの用意方法を回答した', owner: 'cast' }
};

// 面接時の口頭説明チェックリスト（内勤専用、面接当日にその場で使う）
const TALK_CHECKLIST_ITEMS = {
  talkLaw: {
    label: '法律・順守事項',
    color: 'pink',
    points: [
      '各種法律、条例は遵守すること',
      '弊社の営業活動に係る情報（顧客情報、キャスト情報）が外部に漏れないように徹底すること',
      '会社の利益を阻害する行為はしないこと'
    ],
    detail: '休む場合は、できるだけ早く理由を連絡してください。シフトの提出後は責任を持ってこなしてください。変更や欠勤・遅刻が多いと、お店の判断で報酬の変更や、最悪の場合は退店もありますのでご注意ください。<br><br>次の行為は禁止です。無断欠勤、キャスト間での金銭の貸し借り、同業種での掛け持ち（応相談）、出稼ぎ、お店に知らせず移籍・事務所所属・AV出演（他店舗やAV会社からのスカウトは、話が来た時点で必ず報告してください）、裏引き行為（お店を通さずお客と会う行為）、無断での他店への移籍、キャスト間の他店への斡旋——これらは罰金の対象です。一般的なマナー・モラルを逸脱した行為も禁止です。',
    say: '風俗も立派なお仕事です。一般常識をもって仕事に努めてください。場合によっては罰金を払っていただき退店、最悪の場合は管轄警察署へ営業妨害の報告をすることもあります。'
  },
  talkMoney: {
    label: '提示する金額・バック（お給料）',
    color: 'lav',
    points: [
      '弊社から提示する金額は、源泉徴収を除いた後の金額（＝手取り額）です',
      '消費税を含めた金額です',
      'ここから別途、源泉徴収を天引きすることはありません'
    ],
    detail: '',
    say: 'お伝えする金額は、税金を引いた後の手取り額です。ここから後で追加で引かれることはないので、そのまま受け取れる金額だと思ってください。'
  },
  talkLostMoney: {
    label: 'お金のもらい忘れ・貴重品管理',
    color: 'mint',
    points: [
      'お客様と会ったら、まず最初に料金をいただくこと',
      '後回しにしてもらい忘れたり盗まれたりした場合、基本的にはキャスト本人の自己責任になる',
      'お店にはご予約分の金額をお支払いいただく（＝もらい忘れた分は自腹になり得る）',
      '貴重品は待機場でもホテルの部屋でも、肌身離さず持ち歩くこと（お風呂・トイレも含む）'
    ],
    detail: '',
    say: 'お会いしたら真っ先にお金だけは受け取ってください。後回しにして、もし盗まれたりトラブルになったりしても、それは自己責任になってしまいます。お財布や貴重品は、お風呂に入るときも含めて、常に自分の身につけておいてくださいね。'
  },
  talkTransport: {
    label: '交通費・雑費について',
    color: 'peach',
    points: [
      '自宅⇔待機場（池袋、鶯谷、五反田いずれも）……自己負担',
      '自宅→待機場以外の出張先……池袋を拠点として算出（ご本人からの自己申告が必要）',
      '待機場→仕事先（全待機場、出張）……店負担',
      'タクシー……店からの指示があれば店負担'
    ],
    detail: '基本的に交通費は自己申告となるため、店から交通費・領収書の有無の確認はしません。②についてはご申告がない限り算出しません。③④の店負担分も含めて、交通費は一旦キャストさんに立て替えていただき、退勤時のお給料精算のタイミングで一緒に精算します。<br><br>キャストが使用する備品や待機場の維持費、所得税への補填として、10,500円ごとに500円の雑費（上限3,000円）が発生します。',
    say: '交通費はいったん自分で立て替えてもらって、お給料と一緒に精算する形です。あと、備品代や待機場の維持費として、稼いだ額に応じて少額の雑費が引かれます。上限は3,000円なので、そこまでは発生しても大丈夫です。'
  },
  talkRaise: {
    label: '昇給・降給',
    color: 'pink',
    points: [
      '上がる要素：ルール・勤怠が守られている／本指名が一定数ある／週4〜5でまとまったシフトが出せている',
      '下がる要素：ルール違反／クレーム／出発・準備が遅い／連絡がつかない／遅刻・早退・当日欠勤・シフト変更が多い'
    ],
    detail: '',
    say: 'ちゃんとルールを守って、まとまった時間で働いてくれる子はお給料が上がっていきますし、逆に連絡が取れなかったりドタキャンが多いと下がってしまいます。ごく当たり前の仕組みだと思ってください。'
  },
  talkTax: {
    label: '確定申告・インボイス',
    color: 'lav',
    points: [
      'ご自身で確定申告をする際に、源泉徴収票が必要であれば内勤までお問い合わせください',
      'インボイス登録をしている場合は、登録番号を必ず提示してください'
    ],
    detail: '',
    say: '確定申告のときに源泉徴収票が必要になったら、いつでも内勤に言ってください。必要な期間分をお渡しします。'
  }
};

// 在籍店舗の一覧（グループ分け・デフォルトのチェック有無）
const STORE_LIST = [
  { key: 'sakuramoon',   label: 'サクラムーン',       group: 'basic', defaultChecked: true },
  { key: 'lanauguisu',   label: 'ラナ鶯谷',           group: 'basic', defaultChecked: true },
  { key: 'lanakinshi',   label: 'ラナ錦糸町',         group: 'basic', defaultChecked: true },
  { key: 'peachmoon',    label: 'ピーチムーン五反田', group: 'basic', defaultChecked: true },
  { key: 'dressgarden',  label: 'ドレスガーデン渋谷', group: 'basic', defaultChecked: true },
  { key: 'cutie',        label: 'キューティキューティ', group: 'other', defaultChecked: false },
  { key: 'gyakuanal',    label: '逆アナル倶楽部',     group: 'other', defaultChecked: false },
  { key: 'gokumon',      label: '極門',               group: 'other', defaultChecked: false }
];

function defaultStores() {
  const result = {};
  STORE_LIST.forEach(function(s){ result[s.key] = s.defaultChecked; });
  return result;
}

function defaultTalkChecklist() {
  const result = {};
  for (const key in TALK_CHECKLIST_ITEMS) {
    result[key] = { done: false, at: '' };
  }
  return result;
}

function defaultChecklist() {
  const result = {};
  for (const key in CHECKLIST_ITEMS) {
    result[key] = { done: false, at: '' };
  }
  return result;
}
  // ---------- 写したもの ここまで ----------

  const ROLE = (window.ROOM_DB_ROLE === 'cast') ? 'cast' : 'staff';
  // キャストのページはログインしない（ポータルのログインがあっても使わない）
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, ROLE === 'cast'
    ? { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sakura-room-cast' } }
    : { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  /* ---------- 内勤のログインの確かめ（ポータルと同じ：naikin@… で 20 時間以内） ---------- */
  function jwtPayload(s){
    try{
      const p = s.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    }catch(e){ return {}; }
  }
  function sessionExpiresAt(s){
    let t = 0;
    (jwtPayload(s).amr || []).forEach(a=>{ if(a && Number(a.timestamp) > t) t = Number(a.timestamp); });
    return t ? (t + STAFF_HOURS * 3600) * 1000 : 0;
  }
  async function getStaffSession(){
    try{
      const { data } = await sb.auth.getSession();
      const s = data && data.session;
      if(!s || !s.user || String(s.user.email || '').toLowerCase() !== STAFF_EMAIL) return null;
      return Date.now() < sessionExpiresAt(s) ? s : null;
    }catch(e){ return null; }
  }

  /* ---------- 共通 ---------- */
  function q(res){ if(res.error) throw res.error; return res.data; }
  const str = (v)=> v == null ? '' : String(v);
  const iso = (v)=> v ? new Date(v).toISOString() : '';

  // 写真を小さくしてから入れる（スマホの写真は大きいので。長いほうを 1600px・JPEG に）
  function b64ToBlob(b64, type){
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'image/jpeg' });
  }
  function shrink(blob){
    return new Promise(resolve=>{
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = ()=>{
        try{
          const max = 1600, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(b=>{ URL.revokeObjectURL(url); resolve(b && b.size < blob.size ? b : blob); }, 'image/jpeg', 0.85);
        }catch(e){ URL.revokeObjectURL(url); resolve(blob); }
      };
      img.onerror = ()=>{ URL.revokeObjectURL(url); resolve(blob); };   // 読めない形式はそのまま
      img.src = url;
    });
  }
  function randId(n){
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint32Array(n); crypto.getRandomValues(a);
    let s = ''; for(let i = 0; i < n; i++) s += chars.charAt(a[i] % chars.length);
    return s;
  }
  async function uploadPhoto(folder, b64, mime){
    const blob = await shrink(b64ToBlob(b64, mime));
    const type = blob.type || 'image/jpeg';
    const ext = type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] || 'jpg');
    const path = folder + '/' + Date.now() + '_' + randId(10) + '.' + ext;
    q(await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false }));
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function storesAndBacks(body){
    const stores = body.stores && typeof body.stores === 'object' ? body.stores : defaultStores();
    const pick = (pre)=>({ back60: str(body[pre + '60']), back90: str(body[pre + '90']), back120: str(body[pre + '120']),
                           backHonshimei60: str(body[pre + 'Honshimei60']), backHonshimei90: str(body[pre + 'Honshimei90']) });
    return { stores, backCutie: stores.cutie ? pick('backCutie') : {}, backGokumon: stores.gokumon ? pick('backGokumon') : {} };
  }
  function roomOut(r){
    return {
      roomId: r.room_id, castName: r.cast_name, back60: r.back60, back90: r.back90, back120: r.back120,
      backHonshimei60: r.back_honshimei60, backHonshimei90: r.back_honshimei90,
      status: r.status, createdAt: iso(r.created_at), closedAt: iso(r.closed_at),
      checklist: r.checklist || {}, bannerChoice: r.banner_choice || {}, kitChoice: r.kit_choice || {},
      wigChoice: r.wig_choice || {}, comments: r.comments || [], email: r.email || '',
      costumeUrls: r.costume_urls || [], talkChecklist: r.talk_checklist || defaultTalkChecklist(),
      stores: r.stores || defaultStores(), backCutie: r.back_cutie || {}, backGokumon: r.back_gokumon || {},
      notice: r.notice || ''
    };
  }
  const LIST_COLS = 'room_id,cast_name,back60,back90,back120,back_honshimei60,back_honshimei90,status,created_at,closed_at,' +
                    'checklist,banner_choice,kit_choice,wig_choice,comments,email,costume_urls,talk_checklist,stores,back_cutie,back_gokumon,notice';

  /* ---------- キャストの操作（ログインなし。ルームの記号で、自分のルームだけ） ---------- */
  const CAST = {
    async getRoom(p){
      const r = q(await sb.rpc('room_get', { p_id: str(p.id) }));
      if(!r || r.error) return r || { error: 'not_found' };
      const meta = {};
      for(const k in CHECKLIST_ITEMS){ if(CHECKLIST_ITEMS[k].owner !== 'staffOnly') meta[k] = CHECKLIST_ITEMS[k]; }
      r.checklistMeta = meta;
      r.storeList = STORE_LIST;
      if(!r.stores || !Object.keys(r.stores).length) r.stores = defaultStores();
      return r;
    },
    async updateChecklist(b){
      return q(await sb.rpc('room_cast', { p_id: str(b.id), p_action: 'updateChecklist', p_data: { key: b.key, done: !!b.done } }));
    },
    async uploadCostume(b){
      const slot = Number(b.slot);
      if(isNaN(slot) || slot < 0 || slot >= COSTUME_MAX_SLOTS) return { error: 'invalid_slot' };
      if(!b.imageBase64) return { error: 'no_image' };
      if(!q(await sb.rpc('room_is_active', { p_id: str(b.id) }))) return { error: 'closed' };
      let url;
      try{ url = await uploadPhoto('c/' + b.id, b.imageBase64, b.mimeType); }
      catch(e){ return { error: 'upload_error: ' + ((e && e.message) || e) }; }
      return q(await sb.rpc('room_cast', { p_id: str(b.id), p_action: 'setCostume', p_data: { slot, url } }));
    },
  };
  ['deleteCostume','setWigChoice','setKitChoice','setEmail','setGuideRead','setRoadmapRead','setMemo'].forEach(a=>{
    CAST[a] = async (b)=>{
      const d = Object.assign({}, b); delete d.action; delete d.id; delete d.token;
      return q(await sb.rpc('room_cast', { p_id: str(b.id), p_action: a, p_data: d }));
    };
  });

  /* ---------- 内勤の操作 ---------- */
  const STAFF = {
    async checkToken(){ return { valid: !!(await getStaffSession()) }; },

    async listRooms(){
      const rows = [];
      for(let from = 0; ; from += 1000){
        const part = q(await sb.from('room_rooms').select(LIST_COLS).order('created_at', { ascending: false }).range(from, from + 999));
        rows.push.apply(rows, part || []);
        if(!part || part.length < 1000) break;
      }
      return { rooms: rows.map(roomOut), checklistMeta: CHECKLIST_ITEMS, talkChecklistMeta: TALK_CHECKLIST_ITEMS, storeList: STORE_LIST };
    },

    async createRoom(b){
      const x = storesAndBacks(b);
      const roomId = randId(32);
      const row = q(await sb.from('room_rooms').insert({
        room_id: roomId, cast_name: str(b.castName),
        back60: str(b.back60), back90: str(b.back90), back120: str(b.back120),
        back_honshimei60: str(b.backHonshimei60), back_honshimei90: str(b.backHonshimei90),
        checklist: defaultChecklist(), talk_checklist: defaultTalkChecklist(),
        stores: x.stores, back_cutie: x.backCutie, back_gokumon: x.backGokumon,
      }).select('created_at').single());
      return { roomId, createdAt: iso(row.created_at) };
    },

    async closeRoom(b){
      const rows = q(await sb.from('room_rooms').update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('room_id', str(b.id)).select('room_id'));
      return rows && rows.length ? { success: true } : { error: 'not_found' };
    },

    async deleteRoom(b){
      const r = q(await sb.from('room_rooms').select('status').eq('room_id', str(b.id)).maybeSingle());
      if(!r) return { error: 'not_found' };
      if(r.status === 'active') return { error: 'still_active' };
      q(await sb.from('room_rooms').delete().eq('room_id', str(b.id)));
      return { success: true };
    },

    async updateChecklist(b){
      if(!b.isStaff) return { error: 'forbidden' };
      if(!CHECKLIST_ITEMS[b.key]) return { error: 'invalid_key' };
      return q(await sb.rpc('room_staff_check', { p_id: str(b.id), p_field: 'checklist', p_key: b.key, p_done: !!b.done }));
    },

    async updateTalkChecklist(b){
      if(!TALK_CHECKLIST_ITEMS[b.key]) return { error: 'invalid_key' };
      return q(await sb.rpc('room_staff_check', { p_id: str(b.id), p_field: 'talk_checklist', p_key: b.key, p_done: !!b.done }));
    },

    async setNotice(b){
      const notice = str(b.notice);
      const rows = q(await sb.from('room_rooms').update({ notice }).eq('room_id', str(b.id)).select('room_id'));
      return rows && rows.length ? { success: true, notice } : { error: 'not_found' };
    },

    async setStores(b){
      const x = storesAndBacks(b);
      const rows = q(await sb.from('room_rooms').update({ stores: x.stores, back_cutie: x.backCutie, back_gokumon: x.backGokumon })
        .eq('room_id', str(b.id)).select('room_id'));
      return rows && rows.length ? Object.assign({ success: true }, x) : { error: 'not_found' };
    },

    async editRoom(b){
      const x = storesAndBacks(b);
      const v = { castName: str(b.castName), back60: str(b.back60), back90: str(b.back90), back120: str(b.back120),
                  backHonshimei60: str(b.backHonshimei60), backHonshimei90: str(b.backHonshimei90) };
      const rows = q(await sb.from('room_rooms').update({
        cast_name: v.castName, back60: v.back60, back90: v.back90, back120: v.back120,
        back_honshimei60: v.backHonshimei60, back_honshimei90: v.backHonshimei90,
        stores: x.stores, back_cutie: x.backCutie, back_gokumon: x.backGokumon,
      }).eq('room_id', str(b.id)).select('room_id'));
      return rows && rows.length ? Object.assign({ success: true }, v, x) : { error: 'not_found' };
    },

    async addComment(b){
      let photo = '';
      if(b.photoBase64){
        try{ photo = await uploadPhoto('s/' + b.id, b.photoBase64, b.photoMimeType); }
        catch(e){ return { error: 'upload_error: ' + ((e && e.message) || e) }; }
      }
      return q(await sb.rpc('room_staff_add_comment', { p_id: str(b.id), p_text: str(b.text), p_author: str(b.author), p_photo: photo }));
    },

    async editComment(b){
      return q(await sb.rpc('room_staff_edit_comment', { p_id: str(b.id), p_index: Number(b.index), p_text: str(b.text), p_author: str(b.author) }));
    },
  };

  /* ---------- 入口：fetch と同じ形で返す ---------- */
  async function run(url, opts){
    let body = {};
    if(opts && opts.body){ try{ body = JSON.parse(opts.body); }catch(e){ body = {}; } }
    else{
      try{ new URL(url, location.href).searchParams.forEach((v, k)=>{ body[k] = v; }); }catch(e){}
    }
    const a = body.action || '';
    if(ROLE === 'cast') return CAST[a] ? CAST[a](body) : { error: 'invalid_action' };
    if(!STAFF[a]) return { error: 'invalid_action' };
    if(!(await getStaffSession())) return a === 'checkToken' ? { valid: false } : { error: 'unauthorized' };
    try{ return await STAFF[a](body); }
    catch(e){
      const code = String((e && e.code) || '');
      if(code === '42501' || code === 'PGRST301' || code === 'PGRST303' || (e && (e.status === 401 || e.status === 403))) return { error: 'unauthorized' };
      throw e;
    }
  }
  async function roomFetch(url, opts){
    const data = await run(url, opts);
    return { ok: true, status: 200, json: async ()=>data, text: async ()=>JSON.stringify(data) };
  }

  window.roomFetch = roomFetch;
  window.RoomDB = { getStaffSession, sessionExpiresAt, client: sb };
})();
