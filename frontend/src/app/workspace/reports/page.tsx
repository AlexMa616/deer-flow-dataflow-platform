export default function ReportsHub() {
  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-100 p-8 font-sans tracking-wide">
      <h2 className="mb-2 bg-gradient-to-r from-blue-700 to-teal-500 bg-clip-text text-3xl font-bold text-transparent drop-shadow-sm">
        🦌 多模生成式分析中心库 - 【Reports Pool】{" "}
      </h2>
      <p className="text-gray-500">
        所有的由 Data Reporting 主理 Agent 打包生成的 MD 或带样式纯点包单本 HTML
        集中查档于兹！(将与 Outputs 后部对接！目前暂列草案)
      </p>

      {/* Card Groups Grid layout*/}
      <div className="relative mt-8 grid max-w-7xl flex-col gap-6 pb-8 md:p-3 lg:grid-cols-2 lg:gap-8">
        {/* Report Tile Items Prototype!  */}
        <div className="group relative flex gap-4 overflow-hidden rounded-sm border bg-white/70 p-5 shadow duration-500 hover:shadow hover:shadow-cyan-100">
          <div
            role="img"
            className="flex h-[6.5rem] w-24 rotate-3 items-center justify-center rounded-sm bg-sky-50 p-3 font-mono break-all text-cyan-600 italic shadow-inner"
          >
            <small className="rotate-2 leading-3">
              HTML/MD
              <br />
              <br />
              Repv2_{}
            </small>
          </div>
          <div className="z-10 mr-8 block w-full flex-1 shrink flex-col items-start gap-1 overflow-hidden py-2">
            <p className="text-2xs mb-0 w-[22%] -rotate-1 truncate rounded-xl bg-lime-50 px-1 pb-0 font-[math] font-semibold tracking-[-1px] text-amber-500 text-slate-800 uppercase italic select-none">
              ★ LATEST{" "}
            </p>
            <h3 className="delay line-clamp-2 flex text-xl font-bold tracking-[-.1px] break-normal text-slate-700 delay-50 selection:bg-purple-200 md:-mb-1">
              {" "}
              【示例案档】 门店全栈清洗薪酬统计分析.html{" "}
            </h3>
            <h5
              className="cursor:no-drop tracking-1 justify-content mb-auto ml-[min] line-clamp-2 flex min-h-[50%] w-min rounded-md bg-[rgba(66,244,14,0.02)] px-4 break-keep uppercase italic opacity-65 select-none hover:line-clamp-6"
              style={{ lineHeight: 1.7 }}
            >
              {" "}
              <span className="pt-[min(0px, 3vh)] indent break-all mix-blend-color-burn">
                由 [Reporter] 子探生成并于 2026-X 推送! 数据质量健康 优秀 。..
              </span>
            </h5>
          </div>
          <button className="active:opacity-none sm:px-min bgGradient1 cursor lg:group-hover:translate-x-min right select absolute right-0 z-10 scale-0 rounded-[0em_5em_0_0em] p-2 py-8 font-[ui-sans-serif] text-cyan-200 mix-blend-difference outline transition delay-700 group-hover:-inset-y-3 group-hover:scale-y-110 hover:bg-black active:shadow-indigo-700 lg:-mr-1">
            {" "}
            Open Web <br /> Viewer {">"}
          </button>
        </div>

        {/* Waiting placeholder*/}
        <div className="place-center col-span-1 grid rounded border-2 border-dashed bg-slate-200 opacity-100 mix-blend-multiply shadow-inner shadow-[gray] outline-transparent">
          {" "}
          <span className="pointer-events-none mx-auto place-self-center self-center tracking-widest opacity-70">
            等待更多数据报单析出 . . .
          </span>
          <br />{" "}
        </div>
      </div>
    </div>
  );
}
