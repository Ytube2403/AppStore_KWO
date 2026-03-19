# 📱 Hướng Dẫn Sử Dụng — ASO Keyword Optimization Engine

> **Phiên bản:** V3 (Sprint 1 - Intent & Clusters)  
> **Cập nhật:** Tháng 3, 2026

---

## Mục Lục

1. [Tổng Quan](#1-tổng-quan)
2. [Đăng Nhập & Workspace](#2-đăng-nhập--workspace)
3. [Import Dataset từ AppTweak](#3-import-dataset-từ-apptweak)
4. [Giao Diện Bảng Keyword](#4-giao-diện-bảng-keyword)
5. [Bộ Lọc (Filters)](#5-bộ-lọc-filters)
6. [Preset Configuration Engine](#6-preset-configuration-engine)
7. [Dịch Thuật AI (AI Translation)](#7-dịch-thuật-ai-ai-translation)
8. [Intent & Cluster Analysis](#8-intent--cluster-analysis)
9. [Export Dữ Liệu](#9-export-dữ-liệu)
10. [Giải Thích Các Chỉ Số (Metrics)](#10-giải-thích-các-chỉ-số-metrics)

---

## 1. Tổng Quan

**ASO Keyword Optimization Engine** là công cụ nội bộ dùng để:
- Phân tích và đánh giá keyword từ AppTweak
- Tính điểm ưu tiên keyword theo công thức tùy chỉnh
- Nhóm keyword theo Intent (ý định tìm kiếm) và Cluster (nhóm chủ đề)
- Export danh sách keyword đã lọc để dùng cho ASO

**Luồng sử dụng cơ bản:**
```
AppTweak Export CSV → Import Dataset → Cấu hình Preset → Xem & Lọc Keyword → Export
```

---

## 2. Đăng Nhập & Workspace

### Đăng nhập
Truy cập ứng dụng và đăng nhập bằng tài khoản được cấp (Supabase Auth).

### Tạo Workspace
Workspace là đơn vị tổ chức cao nhất — thường tương ứng với **một ứng dụng** hoặc **một dự án ASO**.

1. Từ trang chủ, nhấn **"New Workspace"**
2. Đặt tên cho workspace (ví dụ: `App X - Vietnam`)
3. Nhấn **Tạo**

### Quản lý Dataset trong Workspace
- Mỗi workspace chứa nhiều **Dataset** (mỗi dataset = một lần export CSV từ AppTweak)
- Filter dataset theo **Country/Market** và **Concept/Topic** ở thanh tìm kiếm bên trên

---

## 3. Import Dataset từ AppTweak

### Chuẩn bị file CSV
Export keyword list từ AppTweak dưới định dạng **CSV** (long-format). File cần có các cột chuẩn của AppTweak.

### Các bước Import

1. Vào Workspace → nhấn **"Import Dataset"** (góc trên phải)
2. **Điền thông tin dataset:**
   | Trường | Bắt buộc | Mô tả |
   |--------|----------|-------|
   | Dataset Name | ✅ | Tên để nhận diện, ví dụ: `VN - Competitor Set - Q1` |
   | Country / Market | ❌ | Thị trường, ví dụ: `Vietnam`, `US` |
   | Concept / Topic | ❌ | Chủ đề, ví dụ: `Brand`, `Competitors`, `Casual` |
   | Target App URL | ❌ | URL App Store/Google Play của app mình (cần cho Intent Analysis) |

3. **Upload file CSV** từ AppTweak
4. Nhấn **Import** — hệ thống sẽ parse và lưu keyword vào database

> ⚠️ **Lưu ý:** Quá trình import có thể mất vài giây đến vài phút tùy theo kích thước file.

---

## 4. Giao Diện Bảng Keyword

Sau khi vào một Dataset, bạn sẽ thấy **bảng keyword** với các thành phần:

### Header / Thanh thông tin
| Thành phần | Mô tả |
|-----------|-------|
| **My Keywords** | Tổng số keyword trong dataset (có my_rank) |
| **Filtered** | Số keyword qua được bộ lọc hiện tại |
| **Opportunity** | Keyword đã lọc mà app của tôi đang ranked |
| **Rank Distribution** | Phân bổ ranking theo nhóm: 1-10, 11-20, 21-50, 51-100 |

### Các Cột Trong Bảng
| Cột | Mô tả |
|-----|-------|
| ☑️ Checkbox | Chọn keyword để export riêng |
| **Keyword** | Keyword gốc |
| **Score** | Điểm tổng hợp (0-100) theo Preset — màu = tier (P0/P1/P2/P3) |
| **English** | Bản dịch tiếng Anh (AI generated) |
| **Volume** | Lượt tìm kiếm hiện tại |
| **Max Vol** | Lượt tìm kiếm cao nhất từng ghi nhận |
| **Difficulty** | Độ khó ranking (0-100) |
| **KEI** | Keyword Efficiency Index |
| **My Rank** | Vị trí hiện tại của app trên keyword này |
| **Relevancy** | Số đối thủ đang ranked trên keyword này |

### Tier Score (Màu điểm)
| Tier | Điểm | Ý nghĩa |
|------|------|---------|
| **P0** (đỏ) | ≥ 80 | Ưu tiên cao nhất |
| **P1** (cam) | 65-79 | Ưu tiên cao |
| **P2** (vàng) | 45-64 | Trung bình |
| **P3** (xám) | < 45 | Thấp |

### Click vào 1 hàng
Click vào keyword để xem **detail panel** bên phải với đầy đủ thông tin.

---

## 5. Bộ Lọc (Filters)

Các bộ lọc ở phía trên bảng cho phép thu hẹp danh sách xem:

| Bộ lọc | Mô tả |
|--------|-------|
| **Min Volume** | Chỉ hiển thị keyword có Volume ≥ giá trị này |
| **Min Max Vol** | Chỉ hiển thị keyword có Max Volume ≥ giá trị này (hữu ích khi Volume hiện tại thấp nhưng tiềm năng cao) |
| **Max Difficulty** | Chỉ hiển thị keyword có Difficulty ≤ giá trị này |
| **Min My Rank** | Chỉ hiển thị keyword có My Rank ≤ giá trị này (đang trong top N) |
| **Hide Disqualified** | Ẩn keyword bị loại bởi Preset (mặc định bật) |
| **Show Selected Only** | Chỉ hiển thị keyword đã tick chọn |

> 💡 **Mẹo:** Bật **Hide Disqualified** để chỉ xem keyword qua được ngưỡng của Preset hiện tại.

---

## 6. Preset Configuration Engine

Preset cho phép tùy chỉnh **công thức tính điểm** và **ngưỡng lọc tự động** cho từng dataset.

### Mở Preset Drawer
Nhấn nút **"Preset"** ở góc trên phải bảng → Panel cấu hình trượt ra từ bên phải.

### Phần 1: Score Weights (Trọng số)
Điều chỉnh mức độ quan trọng của từng yếu tố khi tính điểm:

| Yếu tố | Mô tả |
|--------|-------|
| **Volume Weight** | Độ quan trọng của lượng tìm kiếm |
| **Difficulty Weight** | Độ quan trọng của độ khó (weight âm = càng khó càng bị trừ điểm) |
| **Relevancy Weight** | Độ quan trọng của số đối thủ đang ranked |
| **My Rank Weight** | Độ quan trọng của vị trí hiện tại |

> 💡 **Preset có sẵn (Templates):**
> - **Balanced** — Cân bằng các yếu tố
> - **Volume Focus** — Ưu tiên traffic
> - **UA Focus** — Dùng cho team UA: ưu tiên Volume, Difficulty, Relevancy; My Rank thấp hơn
> - **Low Hanging Fruit** — Keyword dễ rank, ít đối thủ

### Phần 2: Qualification Gates (Ngưỡng loại)
Keyword không đạt ngưỡng sẽ bị đánh dấu **Disqualified** (mờ đi trong bảng):

| Cài đặt | Mô tả |
|---------|-------|
| **Min Volume** | Volume tối thiểu để keyword được xem xét |
| **Min Max Volume** | Max Volume tối thiểu |
| **Max Difficulty** | Difficulty tối đa cho phép |
| **Min Relevancy** | Số đối thủ tối thiểu phải đang ranked |

### Áp dụng Preset
1. Cấu hình xong → nhấn **"Apply & Recompute"**
2. Hệ thống sẽ tính lại điểm toàn bộ keyword trong dataset
3. **Lưu Preset**: Nhấn **"Save Preset"** để lưu cấu hình với tên riêng, dùng lại sau

> ⚠️ Nếu bạn thay đổi cài đặt mà chưa Apply, sẽ có cảnh báo **"Unsaved Changes"**.

### Reset về mặc định
Nhấn **"Clear Preset"** để xóa preset hiện tại và trở về điểm mặc định.

---

## 7. Dịch Thuật AI (AI Translation)

Với dataset chứa keyword tiếng nước ngoài (Nhật, Hàn, Thái, v.v.), dùng tính năng AI Translation:

1. (Tùy chọn) Áp dụng bộ lọc để thu hẹp keyword cần dịch
2. Nhấn nút **"Translate"** (icon ✨) ở thanh công cụ
3. Hệ thống sẽ dịch tất cả keyword **chưa có bản dịch** trong view hiện tại
4. Kết quả xuất hiện trong cột **English**

> **Chú ý:** Translation chạy bất đồng bộ (background). Có thanh tiến độ hiển thị phần trăm hoàn thành. Đừng đóng tab khi đang dịch.

---

## 8. Intent & Cluster Analysis

Đây là tính năng phân tích nâng cao, nhóm keyword theo **ý định tìm kiếm** và **chủ đề**.

### Điều kiện cần có
- Dataset phải có **Target App URL** được cấu hình (trong Dataset Settings)
- Worker server phải đang chạy (chạy `npm run dev` trong thư mục `/worker`)

### Chạy Analysis

1. Trong Dataset view, nhấn tab **"Intent & Clusters"** (ngay cạnh tab Keywords)
2. Nhấn **"Generate App Profile"** (lần đầu) — AI sẽ phân tích app của bạn
3. Nhấn **"Start Analysis"**
4. Theo dõi tiến độ qua 3 giai đoạn:
   | Giai đoạn | Mô tả |
   |-----------|-------|
   | **SERP Fetch** | Lấy dữ liệu kết quả tìm kiếm |
   | **Intent Analysis** | AI phân loại ý định của từng keyword |
   | **Clustering** | Nhóm keyword thành clusters |

### Xem kết quả
Sau khi hoàn thành, màn hình hiển thị:
- **Tổng số clusters** tìm được
- **Danh sách clusters** — mỗi cluster có tên, mô tả, và danh sách keyword
- Click vào cluster để mở rộng xem chi tiết các keyword bên trong

---

## 9. Export Dữ Liệu

### Export toàn bộ view hiện tại
1. (Tùy chọn) Áp dụng bộ lọc để chọn keyword muốn export
2. Nhấn nút **"Export"** → chọn định dạng:
   - **CSV** — File CSV chuẩn
   - **Excel (.xlsx)** — File Excel với 2 sheet (Selected + All Filtered)

### Export keyword đã chọn riêng
- Tick checkbox vào các keyword muốn xuất
- File Excel sẽ có sheet riêng cho keyword đã chọn

### Các cột trong file Export
| Cột | Mô tả |
|-----|-------|
| Keyword | Keyword gốc |
| English Translation | Bản dịch tiếng Anh |
| Volume | Lượt tìm kiếm hiện tại |
| Max Volume | Max volume |
| Difficulty | Độ khó |
| KEI | Keyword Efficiency Index |
| My Rank | Vị trí ranking |
| Ranked Competitors Count | Số đối thủ đang ranked |
| Relevance Score | Điểm relevancy |
| Total Score | Điểm tổng hợp |
| Tags | Nhãn (nếu có) |
| Note | Ghi chú của người dùng |

> 💡 File export tự động có tên dạng `ASO_Export_[DatasetName]_[Date].csv/xlsx`

---

## 10. Giải Thích Các Chỉ Số (Metrics)

### Volume vs Max Volume
- **Volume**: Lượt tìm kiếm trung bình hiện tại
- **Max Volume**: Lượt tìm kiếm cao nhất từng ghi nhận (do AppTweak cung cấp)
- Dùng **Max Volume** để filter khi keyword có volume thấp nhưng từng đạt volume cao → tiềm năng theo mùa

### Relevancy (Số đối thủ ranked)
- = Số đối thủ (trong bộ competitor đã import) đang xếp hạng trên keyword này
- Mức tham khảo:
  - **0-1**: Ít đối thủ quan tâm
  - **2-3**: Keyword được chú ý (hiển thị màu cam)
  - **4+**: Keyword quan trọng (highlight mạnh)

### Total Score
Được tính dựa trên Preset đang áp dụng:
```
Score = (Volume_normalized × w_vol) 
      + (Difficulty_inverted × w_dif)  
      + (Relevancy_normalized × w_rel)
      + (MyRank_normalized × w_rank)
```
Điểm từ **0 đến 100**.

### KEI (Keyword Efficiency Index)
Chỉ số hiệu quả keyword, cân bằng giữa volume và độ khó. Được tính bởi AppTweak.

---

## Lưu Ý Quan Trọng

> ⚠️ **Worker Server**: Các tính năng **Translation** (async) và **Intent Analysis** yêu cầu Worker server đang chạy tại `http://localhost:3001`. Nếu không thấy tính năng hoạt động, kiểm tra terminal Worker.

> ⚠️ **Giới hạn dữ liệu**: Mỗi dataset load tối đa **10,000 keyword**. Nếu file AppTweak lớn hơn, hãy chia nhỏ thành nhiều export.

> ✅ **Selections được lưu**: Checkbox chọn keyword được lưu vào database theo từng user — bạn có thể đóng và mở lại mà không mất selection.

---

*Mọi thắc mắc vui lòng liên hệ team phát triển.*
