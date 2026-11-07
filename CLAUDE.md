# CLAUDE.md

# PROJECT: AvatarForge

## 1. PRODUCT VISION

Bu proje, modern sosyal medya ve oyun platformlarındaki gelişmiş avatar oluşturucularına benzer bir deneyim sunan, tamamen bağımsız bir **3D Avatar Creation Platform** olacaktır.

Ürün adı şimdilik:

**AvatarForge**

olarak kullanılabilir.

İsim daha sonra değiştirilebilir.

Temel hedef:

> Kullanıcının birkaç dakika içerisinde kendi 3D avatarını oluşturabildiği, avatarını hareket ettirebildiği, özelleştirebildiği, kaydedebildiği ve ileride başka uygulamalarda API/SDK üzerinden kullanabildiği bağımsız bir avatar platformu oluşturmak.

Bu proje sadece bir web sayfası değildir.

Uzun vadede:

```text
AvatarForge
     │
     ├── Web Avatar Creator
     │
     ├── Avatar API
     │
     ├── Avatar Rendering API
     │
     ├── Animation API
     │
     ├── Mobile SDK
     │
     ├── Unity SDK
     │
     └── Unreal SDK
```

şeklinde büyüyebilecek şekilde tasarlanmalıdır.

---

# 2. IMPORTANT LEGAL / PRODUCT PRINCIPLE

Meta Avatars, Ready Player Me veya başka ticari avatar platformlarının:

* 3D modelleri
* texture'ları
* karakter asset'leri
* özel tasarımları
* kaynak kodları
* proprietary animation sistemleri

kopyalanmayacaktır.

Amaç:

**aynı problem alanında kendi ürünümüzü geliştirmektir.**

Ürün deneyimi açısından modern avatar platformlarından ilham alınabilir.

Ancak tüm:

* 3D karakterler
* kıyafetler
* saç modelleri
* aksesuarlar
* texture'lar
* animasyonlar
* UI
* backend
* API

kendi sistemimize ait veya uygun lisanslı assetlerden oluşmalıdır.

Ticari kullanıma uygunluk baştan düşünülmelidir.

---

# 3. CORE PRODUCT

Kullanıcı web sitesine geldiğinde:

```text
Create Your Avatar
        ↓
Avatar Editor
        ↓
Customize
        ↓
Animate
        ↓
Save
        ↓
Export
```

akışını yaşayacak.

Ana ürün deneyimi çok kaliteli olmalıdır.

Basit bir form veya statik karakter seçme ekranı yapılmayacaktır.

Gerçek bir:

**3D Avatar Creator**

oluşturulacaktır.

---

# 4. MAIN FEATURES

İlk MVP aşağıdaki özelliklere sahip olmalıdır.

## 4.1 3D Avatar

Kullanıcı ekranın merkezinde gerçek zamanlı 3D karakter görecektir.

Karakter:

* döndürülebilmeli
* yakınlaştırılabilmeli
* uzaklaştırılabilmeli
* farklı açılardan incelenebilmeli
* animasyon oynatabilmeli

olmalıdır.

Mouse:

```text
Drag → Rotate
Wheel → Zoom
```

Touch:

```text
Swipe → Rotate
Pinch → Zoom
```

desteklenmelidir.

---

# 5. AVATAR STRUCTURE

Avatar modüler olacaktır.

Temel yapı:

```text
Avatar
│
├── Body
│
├── Head
│
├── Face
│   ├── Eyes
│   ├── Eyebrows
│   ├── Nose
│   ├── Mouth
│   └── Ears
│
├── Hair
│
├── Facial Hair
│   ├── Beard
│   └── Mustache
│
├── Top
│
├── Bottom
│
├── Shoes
│
└── Accessories
    ├── Glasses
    ├── Hat
    ├── Watch
    └── Other
```

Sistem gelecekte yeni kategoriler eklenebilecek şekilde tasarlanmalıdır.

Kategori isimleri hard-code edilmemelidir.

---

# 6. AVATAR CUSTOMIZATION

## Face

Kullanıcı aşağıdaki özellikleri değiştirebilmelidir:

* Face Shape
* Skin Tone
* Eye Shape
* Eye Color
* Eyebrows
* Nose
* Mouth
* Ear Shape

## Hair

* Hair Style
* Hair Color
* Hair Length

## Facial Hair

* Beard Style
* Mustache Style
* Beard Color

## Body

* Body Type
* Height
* Shoulder Width
* Body Proportion

## Clothing

* Shirt
* Jacket
* Pants
* Shorts
* Shoes

## Accessories

* Glasses
* Hat
* Earrings
* Watch
* Necklace
* Other Accessories

---

# 7. MORPH TARGET SYSTEM

Mümkün olduğu durumlarda yüz özellikleri için ayrı ayrı mesh değiştirmek yerine:

**Blend Shapes / Morph Targets**

kullanılmalıdır.

Örneğin:

```text
Face
 ├── JawWidth
 ├── FaceWidth
 ├── CheekSize
 ├── EyeSize
 ├── EyeSpacing
 ├── NoseWidth
 ├── NoseLength
 ├── MouthWidth
 └── LipSize
```

gibi parametreler bulunabilir.

Kullanıcı slider değiştirdiğinde avatar gerçek zamanlı güncellenmelidir.

Örneğin:

```text
Face Shape

●────────────○
```

değiştiğinde karakterin yüzü anında değişmelidir.

---

# 8. AVATAR PRESETS

Kullanıcı isterse hazır avatarlarla başlayabilmelidir.

Örneğin:

```text
Preset 01
Preset 02
Preset 03
Preset 04
```

Ancak preset sistemi final avatar değildir.

Kullanıcı preset'i seçtikten sonra her özelliği değiştirebilmelidir.

---

# 9. RANDOM AVATAR

Bir:

**Randomize**

butonu bulunmalıdır.

Kullanıcı bastığında:

* yüz
* göz
* saç
* sakal
* vücut
* kıyafet
* ayakkabı
* aksesuar

rastgele kombinlenmelidir.

Ancak sonuç estetik açıdan mantıklı kombinasyonlardan oluşmalıdır.

Örneğin:

```text
Formal Outfit
+
Sport Shoes
+
Pirate Hat
```

gibi tamamen anlamsız kombinasyonlar mümkünse engellenmelidir.

Kategori metadata sistemi buna uygun tasarlanmalıdır.

---

# 10. ANIMATION SYSTEM

Avatar sadece duran bir model olmayacaktır.

Avatar animasyon oynatabilmelidir.

İlk sürümde aşağıdaki animasyonlar oluşturulmalıdır:

```text
Idle
Wave
Walk
Run
Jump
Dance
Clap
Laugh
Think
Celebrate
Point
Thumbs Up
Sit
```

Animasyon sistemi:

```text
AnimationController
       ↓
Idle
Walk
Run
Jump
Wave
Dance
...
```

şeklinde modüler olmalıdır.

Kullanıcı avatarını oluşturduktan sonra:

**Animate**

sekmesine geçebilmelidir.

---

# 11. AVATAR ANIMATION PREVIEW

Avatar editöründe küçük bir animation controller bulunabilir.

Örneğin:

```text
▶ Idle

👋 Wave

🚶 Walk

🏃 Run

💃 Dance
```

Kullanıcı animasyona bastığında avatar gerçek zamanlı hareket etmelidir.

Animasyon geçişleri mümkün olduğunca smooth olmalıdır.

Ani pozisyon değişimleri yapılmamalıdır.

---

# 12. FACIAL ANIMATION

Uzun vadede sistem facial animation destekleyecek şekilde tasarlanmalıdır.

Hedef:

```text
Neutral
Smile
Sad
Angry
Surprised
Blink
Talk
Laugh
```

gibi facial expressions.

Bunun için:

**Blend Shapes / Morph Targets**

kullanılabilecek şekilde avatar rig yapısı hazırlanmalıdır.

İlk MVP'de gelişmiş facial tracking zorunlu değildir.

Ancak mimari buna engel olmamalıdır.

---

# 13. FUTURE CAMERA TRACKING

Gelecekte kullanıcı:

```text
Camera
   ↓
Face Tracking
   ↓
Facial Landmarks
   ↓
Avatar Face
```

sistemiyle kendi yüz hareketlerini avatarına aktarabilmelidir.

Örneğin kullanıcı:

😀

yaptığında avatar:

😀

yapmalıdır.

Kullanıcı:

😉

yaptığında avatar göz kırpmalıdır.

Bu özellik MVP'de zorunlu değildir ancak mimari ileride desteklenmelidir.

---

# 14. UI / UX

Tasarım premium bir SaaS / creative tool hissi vermelidir.

Basit Bootstrap admin paneli görünümü kullanılmayacaktır.

Hedef:

```text
Modern
Minimal
Premium
Dark
3D
Creative
Professional
```

bir arayüzdür.

Ana ekran yaklaşık olarak:

```text
┌─────────────────────────────────────────────────────────┐
│ AvatarForge                         Save    Export       │
├───────────────┬─────────────────────────┬───────────────┤
│               │                         │               │
│ CATEGORIES    │                         │  OPTIONS      │
│               │                         │               │
│ Face          │                         │               │
│ Hair          │       3D AVATAR         │ Hair 01       │
│ Eyes          │                         │ Hair 02       │
│ Beard         │                         │ Hair 03       │
│ Body          │                         │ Hair 04       │
│ Clothing      │                         │               │
│ Accessories   │                         │               │
│               │                         │               │
│               │                         │               │
├───────────────┴─────────────────────────┴───────────────┤
│              Animation Controls                         │
│       Idle   Wave   Walk   Run   Dance   Jump           │
└─────────────────────────────────────────────────────────┘
```

Bu sadece konsepttir.

Final UI daha modern ve estetik olmalıdır.

---

# 15. 3D VIEWER

3D viewer uygulamanın en önemli kısmıdır.

Viewer:

* WebGL/WebGPU desteklemeli
* responsive olmalı
* desktop desteklemeli
* mobile browser desteklemeli
* mouse interaction desteklemeli
* touch interaction desteklemeli

olmalıdır.

Kullanıcı avatarı rahatça inceleyebilmelidir.

---

# 16. CAMERA

Kamera kontrolleri:

```text
Orbit
Zoom
Pan
Reset
```

desteklemelidir.

Avatar default olarak iyi bir açıyla gösterilmelidir.

Kullanıcı sistemi açtığında model:

```text
centered
standing
fully visible
properly lit
```

olmalıdır.

---

# 17. LIGHTING

Avatarın kaliteli görünmesi için gerçek zamanlı ışıklandırma kullanılmalıdır.

Tercihen:

```text
Key Light
Fill Light
Rim Light
Environment Light
```

benzeri setup kullanılabilir.

Ama performans önceliklidir.

Aşırı pahalı shader veya gereksiz post-processing kullanılmamalıdır.

---

# 18. 3D ASSET STRATEGY

Asset sistemi çok önemlidir.

Tüm assetler merkezi bir sistemden yönetilebilmelidir.

Örnek:

```text
/assets
    /avatars
    /hair
    /faces
    /clothes
    /shoes
    /accessories
    /animations
```

Ancak frontend içine rastgele dosya yığını koyma.

Asset metadata sistemi oluştur.

Örneğin:

```json
{
  "id": "hair_001",
  "name": "Modern Short",
  "category": "hair",
  "model": "/assets/hair/hair_001.glb",
  "compatibleWith": ["male", "female", "unisex"],
  "colors": [
    "#111111",
    "#3B2415",
    "#8B5A2B"
  ]
}
```

gibi.

Metadata database'den veya JSON manifest sisteminden yönetilebilir.

---

# 19. ASSET COMPATIBILITY

Bazı assetler diğer assetlerle uyumsuz olabilir.

Örneğin belirli bir saç modeli belirli bir şapka ile çakışabilir.

Bu nedenle assetlerde:

```text
compatibleWith
incompatibleWith
category
gender
bodyType
tags
```

gibi metadata alanları bulunabilir.

Sistem buna göre seçenekleri filtreleyebilmelidir.

---

# 20. PERFORMANCE

Bu projenin en önemli teknik gereksinimlerinden biri performanstır.

Avatar creator:

**modern masaüstü bilgisayarlarda akıcı**

ve

**orta seviye mobil cihazlarda kullanılabilir**

olmalıdır.

Özellikle:

* polygon count
* texture resolution
* draw calls
* shader complexity
* memory usage
* asset loading
* animation performance

kontrol edilmelidir.

GLB/GLTF optimize edilmelidir.

Gerekirse:

```text
LOD
Texture Compression
Draco
Mesh Optimization
Lazy Loading
Asset Caching
```

kullanılmalıdır.

---

# 21. RESPONSIVE

Web uygulaması:

```text
Desktop
Tablet
Mobile
```

desteklemelidir.

Mobil görünümde:

```text
Avatar
   ↓
Category tabs
   ↓
Horizontal option carousel
```

gibi bir yapı kullanılabilir.

Desktop'ta:

```text
Left categories
+
Center 3D viewer
+
Right options
```

kullanılabilir.

---

# 22. SAVE SYSTEM

Kullanıcı avatarını kaydedebilmelidir.

Avatarın tamamını her seferinde yeni 3D model olarak kaydetmek yerine:

**Avatar Configuration**

saklanmalıdır.

Örneğin:

```json
{
  "body": {
    "type": 2,
    "height": 0.92
  },
  "face": {
    "shape": 4,
    "skin": 3,
    "eyes": 5,
    "nose": 2,
    "mouth": 6
  },
  "hair": {
    "style": 12,
    "color": "#24160E"
  },
  "beard": {
    "style": 3,
    "color": "#24160E"
  },
  "clothing": {
    "top": 12,
    "bottom": 8,
    "shoes": 4
  },
  "accessories": [
    2
  ]
}
```

Bu configuration avatarı tekrar oluşturmak için yeterli olmalıdır.

---

# 23. EXPORT

Uzun vadede kullanıcı avatarını export edebilmelidir.

Hedef formatlar:

```text
GLB
GLTF
PNG
JPG
```

Özellikle:

**GLB**

öncelikli olmalıdır.

Avatarı farklı platformlarda kullanılabilecek hale getirmek ürünün önemli bir parçasıdır.

---

# 24. API-FIRST ARCHITECTURE

Bu proje sadece frontend olarak düşünülmemelidir.

Uzun vadede AvatarForge:

**Avatar API Platform**

olacaktır.

API:

```text
/api/v1/avatar
/api/v1/avatar/{id}
/api/v1/avatar/{id}/configuration
/api/v1/avatar/{id}/render
/api/v1/avatar/{id}/animation
/api/v1/assets
```

gibi versioned bir yapıya sahip olmalıdır.

API version:

```text
v1
```

şeklinde başlamalıdır.

---

# 25. API USE CASE

Başka bir uygulama AvatarForge kullanarak:

```text
POST /api/v1/avatar
```

ile avatar oluşturabilmeli.

Sonra:

```text
GET /api/v1/avatar/{id}
```

ile avatar bilgilerini alabilmeli.

Configuration:

```text
GET /api/v1/avatar/{id}/configuration
```

ile alınabilmeli.

Render:

```text
POST /api/v1/avatar/{id}/render
```

gibi endpointlerle yapılabilmeli.

Bu API yapısı daha sonra ücretli SaaS hizmetine dönüştürülebilecek şekilde tasarlanmalıdır.

---

# 26. API AUTHENTICATION

Uzun vadede:

```text
API Key
OAuth
JWT
```

gibi authentication yöntemleri desteklenebilir.

İlk MVP'de basit authentication yeterlidir.

Ancak API architecture buna uygun hazırlanmalıdır.

---

# 27. DEVELOPER DASHBOARD

İleride müşteriler için:

```text
Dashboard
```

oluşturulacaktır.

Dashboard:

```text
Projects
API Keys
Avatars
Usage
Requests
Billing
Documentation
```

alanlarını içerebilir.

İlk MVP'de billing yapmak zorunda değilsin.

Ancak mimari gelecekte buna uygun olmalıdır.

---

# 28. AVATAR RENDER API

Uzun vadede müşteriler:

```text
Avatar ID
+
Animation
+
Camera
+
Background
```

vererek render alabilmelidir.

Örneğin:

```text
POST /api/v1/avatar/render
```

request:

```json
{
  "avatarId": "av_123",
  "animation": "wave",
  "camera": "front",
  "background": "transparent",
  "format": "png"
}
```

response:

```json
{
  "url": "...",
  "format": "png"
}
```

Bu yapı gelecekte sosyal medya uygulamaları, oyunlar, eğitim platformları, fitness uygulamaları ve benzeri sistemlere satılabilir.

---

# 29. DATABASE

Database yapısı avatar configuration ile asset metadata'yı ayırmalıdır.

Örnek:

```text
Users
Avatars
AvatarConfigurations
Assets
AssetCategories
Animations
Projects
ApiKeys
ApiUsage
```

İlk MVP'de gereksiz tablolar oluşturma.

Ama domain model gelecekte genişletilebilir olmalıdır.

---

# 30. TECH STACK

Proje başlamadan önce mevcut ihtiyaçları analiz et.

Tercihen:

### Frontend

```text
Next.js
React
TypeScript
Three.js
React Three Fiber
```

veya performans/uyumluluk açısından daha uygun bir alternatif.

### Backend

```text
ASP.NET Core
```

veya proje için daha uygun bir backend teknolojisi.

Kullanılacak teknoloji seçilirken:

* performans
* 3D entegrasyonu
* API geliştirme
* deployment
* scalability

dikkate alınmalıdır.

### 3D

```text
Blender
GLB / GLTF
Three.js
```

kullanılabilir.

---

# 31. DEVELOPMENT PRINCIPLE

Kodlamaya başlamadan önce projeyi analiz et.

Bana önce:

```text
1. Architecture
2. Technology Stack
3. Folder Structure
4. 3D Strategy
5. Avatar Data Model
6. Animation Strategy
7. API Strategy
8. MVP Roadmap
```

sun.

Benim onayımı beklemek zorunda değilsin.

Analizden sonra implementasyona devam et.

---

# 32. MVP PHASES

## PHASE 1

Çalışan 3D avatar.

* 3D model
* camera
* orbit
* zoom
* lighting
* responsive viewer

## PHASE 2

Avatar customization.

* face
* hair
* eyes
* beard
* body
* clothes
* shoes
* accessories

## PHASE 3

Animation.

* idle
* walk
* run
* wave
* jump
* dance

## PHASE 4

Persistence.

* save
* load
* reset
* presets
* randomize

## PHASE 5

Export.

* GLB
* GLTF
* PNG
* JPG

## PHASE 6

API.

* avatar creation
* avatar configuration
* avatar retrieval
* rendering

## PHASE 7

Developer platform.

* API keys
* projects
* usage
* documentation
* dashboard

## PHASE 8

Advanced AI.

Gelecekte:

```text
Photo
 ↓
AI Face Analysis
 ↓
Avatar Parameters
 ↓
3D Avatar
```

sistemi eklenebilir.

---

# 33. AI ARCHITECTURE

AI özelliğini ilk aşamada sisteme zorla ekleme.

Önce sağlam bir deterministic avatar system oluştur.

Daha sonra AI:

```text
Photo → Face Analysis
Text → Avatar Configuration
Image → Style Transfer
Voice → Facial Animation
Camera → Face Tracking
```

gibi özellikler için kullanılabilir.

Örneğin gelecekte kullanıcı:

> "Bana siyah takım elbiseli, kısa saçlı ve gözlüklü bir avatar oluştur."

dediğinde:

```text
Natural Language
       ↓
AI
       ↓
Avatar Configuration JSON
       ↓
Avatar Renderer
```

çalışabilir.

---

# 34. PRODUCT DIFFERENTIATION

Bu ürünün amacı sadece:

"Bir avatar seç"

değildir.

Hedef:

**Avatar creation infrastructure**

oluşturmaktır.

Rakiplerden ayrışabilecek özellikler:

* kolay avatar creation
* yüksek kalite
* modern UI
* düşük maliyet
* API-first
* developer-friendly
* web + mobile uyumlu
* export
* animations
* future AI integration
* kendi asset ecosystem'i

olmalıdır.

---

# 35. IMPORTANT: DO NOT FAKE FEATURES

Sadece UI oluşturup özelliği varmış gibi gösterme.

Örneğin:

"Animation"

butonu varsa gerçekten avatarı hareket ettirmeli.

"Save"

butonu varsa gerçekten configuration kaydedilmeli.

"Export"

butonu varsa gerçekten export işlemi yapılmalı.

"API"

varsa gerçek endpoint oluşturulmalı.

Mock data sadece geliştirme aşamasında kullanılabilir.

Final MVP'de temel fonksiyonlar gerçek çalışmalıdır.

---

# 36. CODE QUALITY

Kod:

* modular
* maintainable
* scalable
* typed
* documented where necessary
* testable

olmalıdır.

Tek bir component içine bütün avatar sistemini yazma.

Avatar sistemini:

```text
AvatarViewer
AvatarEditor
AvatarCustomizer
AvatarCategory
AvatarOptions
AvatarState
AvatarService
AvatarRepository
AnimationController
AssetManager
```

gibi mantıksal bölümlere ayır.

İsimleri kullanılan framework convention'ına göre düzenle.

---

# 37. ERROR HANDLING

Asset yüklenemezse uygulama çökmemeli.

Animation yüklenemezse avatar yine görüntülenmeli.

API başarısız olursa kullanıcıya anlaşılır hata gösterilmeli.

3D model bulunamazsa fallback model kullanılmalı.

---

# 38. LOADING EXPERIENCE

3D asset yüklenirken:

```text
Loading Avatar...
```

veya modern bir skeleton/loading animation gösterilebilir.

Kullanıcı boş ekran görmemeli.

---

# 39. FIRST DELIVERABLE

İlk teslimde çalışan bir:

**Avatar Creator Web Application**

oluştur.

Kullanıcı:

1. Siteyi açacak.
2. 3D avatar görecek.
3. Avatarı döndürecek.
4. Zoom yapacak.
5. Saç değiştirecek.
6. Yüz değiştirecek.
7. Göz değiştirecek.
8. Sakal değiştirecek.
9. Kıyafet değiştirecek.
10. Ayakkabı değiştirecek.
11. Aksesuar ekleyecek.
12. Avatarı hareket ettirecek.
13. Random avatar oluşturacak.
14. Avatarı kaydedecek.
15. Avatarı tekrar yükleyecek.
16. Avatarı export edebilecek.

Bu akış çalışmalıdır.

---

# 40. VISUAL QUALITY BAR

Ortaya çıkan ürün:

"developer demo"

gibi görünmemelidir.

Bir startup'ın gerçek ürünü gibi görünmelidir.

Kalite hedefi:

```text
Modern SaaS
+
3D Character Creator
+
Game Character Editor
+
Premium UI
```

kombinasyonudur.

Özellikle:

* typography
* spacing
* colors
* transitions
* animations
* 3D lighting
* interaction
* responsive design

konularına dikkat et.

---

# 41. DO NOT OVERENGINEER

İlk sürümde:

* ödeme sistemi
* billing
* enterprise dashboard
* gelişmiş AI
* multiplayer
* social network
* complex cloud rendering

yapma.

Önce gerçekten çalışan avatar creator oluştur.

Ancak mimari gelecekte bu özellikleri eklemeye uygun olsun.

---

# 42. FINAL PRODUCT VISION

Uzun vadede ürün şu hale gelmelidir:

```text
                  AVATARFORGE
                       │
          ┌────────────┼────────────┐
          │            │            │
       Web App      REST API      SDK
          │            │            │
          │            │       ┌────┼────┐
          │            │       │    │    │
       Browser      Developers Mobile Unity
                              │
                           Unreal
```

Bir geliştirici kendi uygulamasına:

```text
AvatarForge SDK
```

ekleyerek kullanıcılarına avatar oluşturma özelliği sağlayabilmelidir.

Bir kullanıcı:

```text
Avatar oluştur
→ Özelleştir
→ Animasyon
→ Kaydet
→ Export
```

yapabilmelidir.

---

# 43. IMMEDIATE TASK

Şimdi şu sırayla ilerle:

### STEP 1

Proje klasörünü analiz et.

### STEP 2

Mevcut teknoloji ve mimariyi belirle.

### STEP 3

3D rendering teknolojisini seç.

### STEP 4

Avatar architecture oluştur.

### STEP 5

İlk çalışan 3D avatarı ekle.

### STEP 6

Customization sistemini oluştur.

### STEP 7

Animation sistemini oluştur.

### STEP 8

Save / Load sistemini oluştur.

### STEP 9

Export sistemini oluştur.

### STEP 10

API architecture için temel backend'i oluştur.

Her aşamada çalışan kod üret.

Sadece tasarım mockup'ı oluşturma.

---

# 44. MOST IMPORTANT PRINCIPLE

Bu proje:

**"Meta'nın avatarını yeniden yapalım."**

projesi değildir.

Bu proje:

**"Meta seviyesinde bir kullanıcı deneyimi sunan, bağımsız, geliştirici dostu ve ticari olarak kullanılabilir bir Avatar Platformu oluşturalım."**

projesidir.

Tüm teknik kararları bu hedef doğrultusunda ver.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
