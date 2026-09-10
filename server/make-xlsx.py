#!/usr/bin/env python3
"""
케이스 결과 → 엑셀. 손으로 채우지 않는다.

  node server/run-cases.mjs --json > server/results.json
  python3 server/make-xlsx.py

개선 이력(hist)만 사람이 손으로 늘린다 — 실패를 고칠 때마다 한 줄.
"""
import json, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

rows = json.load(open('server/results.json'))
TODAY = '2026-09-10'
FONT = 'Arial'

wb = Workbook()
thin = Side(style='thin', color='D0D7E5')
box = Border(left=thin, right=thin, top=thin, bottom=thin)
hdr_fill = PatternFill('solid', fgColor='1B57D6')
hdr_font = Font(name=FONT, bold=True, color='FFFFFF', size=10)
base = Font(name=FONT, size=10)
wrap = Alignment(wrap_text=True, vertical='top')

def style_header(ws, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill = hdr_fill; cell.font = hdr_font
        cell.alignment = Alignment(vertical='center', horizontal='center')
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f"A1:{get_column_letter(ncols)}{ws.max_row}"

# ---------- 1. 케이스 결과 ----------
ws = wb.active
ws.title = '케이스 결과'
cols = ['범주','물음(입력)','뽑은 경유지','도착 마감','이동수단','순서','거절','되묻기','판정','실패 사유','메모']
ws.append(cols)
for r in rows:
    ws.append([
        r['group'], r['text'], r['stops'],
        '' if r['arriveBy'] is None else f"{r['arriveBy']//60:02d}:{r['arriveBy']%60:02d}",
        r['mode'] or '', r['order'], r['reject'], r['ambiguous'],
        r['verdict'], r['fails'], r['note'],
    ])
widths = [11, 44, 30, 10, 10, 10, 26, 30, 8, 26, 34]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w
for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(cols)):
    for c in row:
        c.font = base; c.border = box; c.alignment = wrap
# 판정 색
green = PatternFill('solid', fgColor='DDF2E7'); red = PatternFill('solid', fgColor='FBE0DC')
amber = PatternFill('solid', fgColor='FDF3E4')
for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
    v = row[8].value
    row[8].fill = green if v == '통과' else red if v == '실패' else amber
    row[8].font = Font(name=FONT, size=10, bold=True)
style_header(ws, len(cols))

# ---------- 2. 요약 ----------
s = wb.create_sheet('요약')
s.append(['지표', '값'])
last = ws.max_row
s.append(['전체', f'=COUNTA(\'케이스 결과\'!B2:B{last})'])
s.append(['통과', f'=COUNTIF(\'케이스 결과\'!I2:I{last},"통과")'])
s.append(['실패', f'=COUNTIF(\'케이스 결과\'!I2:I{last},"실패")'])
s.append(['미검증', f'=COUNTIF(\'케이스 결과\'!I2:I{last},"미검증")'])
s.append(['검증 통과율', f'=IFERROR(B3/(B3+B4),"")'])
s.append([])
s.append(['범주', '전체', '실패'])
groups = sorted({r['group'] for r in rows})
for g in groups:
    rr = s.max_row + 1
    s.append([g, f'=COUNTIF(\'케이스 결과\'!A2:A{last},A{rr})',
                 f'=COUNTIFS(\'케이스 결과\'!A2:A{last},A{rr},\'케이스 결과\'!I2:I{last},"실패")'])
s.append([])
s.append(['LLM(gpt-5.6-sol) 실측', ''])
try:
    import os as _os
    if _os.path.exists('server/llm-results.json'):
        _l = json.load(open('server/llm-results.json'))
        _c = lambda v: len([x for x in _l if x['verdict'] == v])
        s.append(['LLM 통과', _c('통과')])
        s.append(['LLM 실패', _c('실패')])
        s.append(['LLM 무응답', _c('무응답')])
except Exception:
    pass

s.column_dimensions['A'].width = 18; s.column_dimensions['B'].width = 12; s.column_dimensions['C'].width = 10
for row in s.iter_rows(min_row=1, max_row=s.max_row, max_col=3):
    for c in row:
        c.font = base; c.border = box
for c in ('A1','B1'):
    s[c].fill = hdr_fill; s[c].font = hdr_font
for c in ('A8','B8','C8'):
    s[c].fill = hdr_fill; s[c].font = hdr_font
s['B6'].number_format = '0.0%'

# ---------- 2.5 LLM 결과 (있으면) ----------
import os
if os.path.exists('server/llm-results.json'):
    lrows = json.load(open('server/llm-results.json'))
    L = wb.create_sheet('LLM 결과')
    L.append(cols)
    for r in lrows:
        L.append([
            r['group'], r['text'], r['stops'],
            '' if r['arriveBy'] is None else str(r['arriveBy']),
            r['mode'] or '', r['order'], r['reject'], r['ambiguous'],
            r['verdict'], r['fails'], r['note'],
        ])
    for i, w in enumerate(widths, 1):
        L.column_dimensions[get_column_letter(i)].width = w
    for row in L.iter_rows(min_row=2, max_row=L.max_row, max_col=len(cols)):
        for c in row:
            c.font = base; c.border = box; c.alignment = wrap
    for row in L.iter_rows(min_row=2, max_row=L.max_row):
        v = row[8].value
        row[8].fill = green if v == '통과' else red if v in ('실패','무응답') else amber
        row[8].font = Font(name=FONT, size=10, bold=True)
    style_header(L, len(cols))

# ---------- 3. 개선 이력 ----------
h = wb.create_sheet('개선 이력')
h.append(['날짜','스키마','무엇이 문제였나','왜 문제였나','어떻게 고쳤나','효과'])
hist = [
 (TODAY,'v1→v2','같은 브랜드를 여러 곳 요청해도 1곳으로 처리','스키마에 count가 없었다','IntentStop.count 추가','"올리브영 3개" 통과'),
 (TODAY,'v1→v2','"빵집 빼줘"를 해석 못 함','프롬프트가 무상태였다. 채팅은 한 번에 끝나지 않는다','입력에 currentStops 추가','대화형 수정 가능'),
 (TODAY,'v1→v2','"택배"를 우체국으로 단정','카테고리를 하나로 좁혀 넘겨짚었다','queries를 배열로 — 후보를 여럿 낸다','편의점도 후보에 남음'),
 (TODAY,'v2→v3','"회사 말고 집으로" 표현 불가','목적지 변경을 담을 자리가 스키마에 없었다','endpoints 추가. 좌표 아는 곳만 적용, 아니면 되묻기','목적지/출발지 변경 통과'),
 (TODAY,'v2→v3','"올리브영 대신 이마트" 표현 불가','op이 문장당 하나여서 제거+추가를 못 담았다','op을 경유지마다 붙임','교체 통과'),
 (TODAY,'v2→v3','"순서 바꿔줘" 표현 불가','orderLocked가 boolean이라 3번째 상태가 없었다','order: auto|locked|reshuffle','순서 변경 통과'),
 (TODAY,'v3','못 알아들은 요청과 인사가 똑같이 침묵','빈 결과에 되묻기가 없어 사용자는 앱이 죽은 줄 안다','요청처럼 보이는데 아무것도 못 뽑으면 ambiguous','오타·줄임말·영문·다국어 12건이 되묻기로'),
 (TODAY,'v3','"올리브영은 안 들러도 돼"가 올리브영을 경유지로 만듦','부정문을 보지 않아 정반대로 동작','부정어 뒤만 추출 범위로 자름','"커피는 됐고 은행만"의 은행도 살아남음'),
 (TODAY,'v3','"지하철로 걸어서 차로" 중 하나를 임의 선택','충돌인데 고르면 절반은 틀린다','충돌 감지 → 되묻기','오답 대신 질문'),
 (TODAY,'v3','마감이 여럿일 때 마지막 것 사용','늦은 마감을 고르면 지각한다','가장 이른 것 채택','마감은 빡빡한 쪽으로'),
 (TODAY,'v3','프롬프트 인젝션에 무방비','"이전 지시 무시" 같은 말을 거르지 않음','1차선: reject / 실제 방어선: 서버 schema.ts 검증','LLM이 뭘 뱉든 스키마 통과 필수'),
 (TODAY,'러너','합격률이 부풀려짐(117/122로 보임)','note만 있고 검증 조건 없는 케이스가 자동 통과','미검증을 따로 셈','실상은 검증 105 중 실패 6이었다'),
 (TODAY,'기대값','기대값을 목의 한계에 맞춰 정해놨다','"올리브용"을 "못 잡으면 되묻기"로 적었다. 구현의 한계를 제품 사양으로 굳힌 것','Codex 실측 후 제품 기준으로 상향 — 오타/줄임말/영문/다국어 13건','목은 이제 실패하지만 그게 정직하다. 목과 LLM의 격차가 숫자로 보인다'),
 (TODAY,'프롬프트','Codex가 "3시간 걸려도 괜찮아"를 reject','"길찾기와 무관하면 reject" 규칙을 과잉 적용. 이동 얘기인데 거절','reject를 날씨·뉴스·번역·시스템 캐기로 좁게 정의','뽑을 게 없으면 빈 결과, 거절은 무관할 때만'),
 (TODAY,'프롬프트','endpoints를 4건 전부 놓침','스키마엔 있는데 프롬프트가 시키지 못했다. "회사 말고 집으로"가 dest=null','프롬프트에 예시 3개를 박아 넣음(destination/origin/되묻기)','재실행으로 확인 필요'),
 (TODAY,'리스크','"구시까지 도착"이 한 번은 맞고 한 번은 틀림','LLM 비결정성. 36건 테스트에선 09:00, 147건에선 null','temperature=0으로 낮췄으나 근본 해결은 아님. 칩 UI로 사용자가 보고 고치게 하는 게 실질 방어','같은 말에 다른 결과는 신뢰를 한 번에 무너뜨린다'),
 (TODAY,'실측','전체 147건 LLM 기준선 확보','목 128 통과 / LLM 133 통과. 무응답 0','run-llm.mjs로 40건씩 4배치, 총 101K 토큰','목과 LLM을 같은 채점 규칙으로 비교 가능해짐'),
 (TODAY,'실측','목이 못 하던 12건을 Codex가 전부 처리','오타·줄임말·영문·일본어·중국어·음성인식 오류까지 교정','서버 연결 전 codex exec로 36건 실측(25K 토큰)','LLM 연결의 값이 숫자로 확인됨. 목은 fallback 용도로만'),
]
for r in hist: h.append(list(r))
for i, w in enumerate([12, 10, 40, 40, 42, 34], 1):
    h.column_dimensions[get_column_letter(i)].width = w
for row in h.iter_rows(min_row=2, max_row=h.max_row, max_col=6):
    for c in row:
        c.font = base; c.border = box; c.alignment = wrap
style_header(h, 6)

# ---------- 4. 쓰는 법 ----------
g = wb.create_sheet('쓰는 법')
guide = [
 ['이 파일은 손으로 채우지 않는다', ''],
 ['', ''],
 ['1. 케이스를 추가한다', 'server/prompts/cases.jsonl 에 한 줄 추가'],
 ['2. 돌린다', 'node server/run-cases.mjs'],
 ['3. 엑셀을 다시 만든다', 'node server/run-cases.mjs --json > server/results.json 후 스크립트 실행'],
 ['', ''],
 ['판정의 뜻', ''],
 ['통과', '기대값을 만족했다'],
 ['실패', '기대값과 어긋났다 — 실패 사유 열을 본다'],
 ['미검증', 'note만 있고 기대값이 없다. 통과가 아니다 — 기대값을 정해야 한다'],
 ['', ''],
 ['지금 재는 대상', '로컬 목(src/lib/intent.ts)이지 LLM이 아니다.'],
 ['', 'OpenAI를 붙인 뒤 같은 147개를 서버로 돌려 이 기준선과 비교한다.'],
 ['', '목이 통과한 것을 LLM이 실패할 수도, 그 반대일 수도 있다.'],
 ['', ''],
 ['개선 이력을 쌓는 이유', '같은 실수를 두 번 하지 않기 위해서다.'],
 ['', '실패를 고칠 때마다 무엇이/왜/어떻게를 한 줄 남긴다.'],
]
for r in guide: g.append(r)
g.column_dimensions['A'].width = 26; g.column_dimensions['B'].width = 76
for row in g.iter_rows(min_row=1, max_row=g.max_row, max_col=2):
    for c in row:
        c.font = base; c.alignment = wrap
g['A1'].font = Font(name=FONT, size=12, bold=True)
for c in ('A7','A16'):
    g[c].font = Font(name=FONT, size=10, bold=True)

wb.save('docs/채팅-추출-시뮬레이션.xlsx')
print('saved')
