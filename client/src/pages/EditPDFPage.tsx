import React, { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { Rnd } from "react-rnd";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShippingForm } from "@/components/preview/ShippingForm";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";

// Configuration for the pages:
const pageConfig = {
  finalWidth: 600,
  finalHeight: 600,
  idealMinContainerWidth: 2 * 600 + 32,
};

//
// ScalablePreview Component (unchanged)
//
function ScalablePreview({ children, onScaleChange }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const scaleFactor = containerWidth / pageConfig.finalWidth;
        setScale(scaleFactor);
        if (onScaleChange) onScaleChange(scaleFactor);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [onScaleChange]);
  return (
    <div ref={containerRef} style={{ width: "100%", overflow: "auto" }}>
      <div
        style={{
          width: `${pageConfig.finalWidth}px`,
          height: `${pageConfig.finalHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}

//
// ResizableTextBox Component – Final Version
//
const ResizableTextBox = ({
  x,
  y,
  width,
  height,
  fontSize,
  color,
  fontFamily,
  lines,
  scale,
  onUpdate,
  onTextChange,
  setGlobalIsEditing,
  initialSide, // "left" or "right" when mounted (based on page id)
}) => {
  // Maintain local (internal) position state.
  const [localX, setLocalX] = useState(x);
  const [localY, setLocalY] = useState(y);
  // Track which page the box is on
  const [currentSide, setCurrentSide] = useState(initialSide);
  // Track editing mode for styling.
  const [isEditingMode, setIsEditingMode] = useState(false);
  const textBoxRef = useRef(null);

  // Sync internal position if parent's values change.
  useEffect(() => {
    setLocalX(x);
    setLocalY(y);
    setCurrentSide(initialSide);
  }, [x, y, initialSide]);

  return (
    <Rnd
      bounds="#spreadContainer"
      enableUserSelectHack={false}
      disableDragging={isEditingMode}
      size={{ width: width * scale, height: height * scale }}
      position={{ x: localX * scale, y: localY * scale }}
      onDrag={(e, d) => {
        const newX = d.x / scale;
        const newY = d.y / scale;

        // If on the left page and newX meets or exceeds the page's width,
        // commit the position to the right page.
        if (currentSide === "left" && newX >= pageConfig.finalWidth) {
          const excess = newX - pageConfig.finalWidth;
          setCurrentSide("right");
          onTextChange({ left: [], right: lines });
          setLocalX(excess);
          setLocalY(newY);
          onUpdate({ x: excess, y: newY, width, height, side: "right" });
          return;
        }
        // If on the right page and newX becomes negative, commit the position to the left page.
        if (currentSide === "right" && newX < 0) {
          const excess = newX; // negative
          const newXForLeft = pageConfig.finalWidth + excess;
          setCurrentSide("left");
          onTextChange({ left: lines, right: [] });
          setLocalX(newXForLeft);
          setLocalY(newY);
          onUpdate({ x: newXForLeft, y: newY, width, height, side: "left" });
          return;
        }
        // Otherwise update the position normally.
        setLocalX(newX);
        setLocalY(newY);
        onUpdate({ x: newX, y: newY, width, height, side: currentSide });
      }}
      onDragStop={(e, d) => {
        const finalX = d.x / scale;
        const finalY = d.y / scale;
        setLocalX(finalX);
        setLocalY(finalY);
        onUpdate({ x: finalX, y: finalY, width, height, side: currentSide });
      }}
      onResizeStop={(e, direction, ref, delta, position) => {
        const updatedX = position.x / scale;
        const updatedY = position.y / scale;
        setLocalX(updatedX);
        setLocalY(updatedY);
        onUpdate({
          x: updatedX,
          y: updatedY,
          width: ref.offsetWidth / scale,
          height: ref.offsetHeight / scale,
          side: currentSide,
        });
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        border: isEditingMode
          ? "2px solid #3b82f6"
          : lines.join("").trim() === ""
            ? "none"
            : "1px dashed #ddd",
        cursor: isEditingMode ? "text" : "move",
        background: "transparent",
        boxSizing: "border-box",
      }}
    >
      <div
        ref={textBoxRef}
        contentEditable={isEditingMode}
        suppressContentEditableWarning
        style={{
          width: "100%",
          height: "100%",
          fontSize,
          color,
          fontFamily,
          padding: "10px",
          outline: "none",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          textAlign: "center",
          boxSizing: "border-box",
          userSelect: isEditingMode ? "text" : "none",
          pointerEvents: "auto",
          cursor: isEditingMode ? "text" : "move",
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setIsEditingMode(true);
          setGlobalIsEditing(true);
          setTimeout(() => {
            const range = document.createRange();
            range.selectNodeContents(textBoxRef.current);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }, 0);
        }}
        onBlur={(e) => {
          setIsEditingMode(false);
          setGlobalIsEditing(false);
          const html = e.currentTarget.innerHTML;
          const newLines = html
            .replace(/<div><br><\/div>/g, "\n")
            .replace(/<div>/g, "\n")
            .replace(/<\/div>/g, "")
            .replace(/<br>/g, "\n")
            .replace(/&nbsp;/g, " ")
            .trim()
            .split("\n");
          onTextChange(newLines);
          window.getSelection()?.removeAllRanges();
        }}
      >
        {lines.join("\n")}
      </div>
    </Rnd>
  );
};

//
// EditPDFPage Component – Final Version
//
export default function EditPDFPage() {
  const { bookId } = useParams();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth);
  const [currentScale, setCurrentScale] = useState(1);
  const [currentSpreadIdx, setCurrentSpreadIdx] = useState(0);

  // Editing controls for selected text box
  const [selectedPageIdx, setSelectedPageIdx] = useState(null);
  const [editingFontSize, setEditingFontSize] = useState(16);
  const [editingColor, setEditingColor] = useState("#000000");
  const [editingFontFamily, setEditingFontFamily] = useState("Nunito");

  const [showShippingForm, setShowShippingForm] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    function handleResize() {
      setAvailableWidth(window.innerWidth);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const effectiveMinContainerWidth =
    availableWidth < pageConfig.idealMinContainerWidth
      ? availableWidth
      : pageConfig.idealMinContainerWidth;
  const effectivePageWidth =
    availableWidth < pageConfig.idealMinContainerWidth
      ? (availableWidth - 50) / 2
      : pageConfig.finalWidth;
  const effectivePageHeight =
    availableWidth < pageConfig.idealMinContainerWidth
      ? (availableWidth - 50) / 2
      : pageConfig.finalHeight;

  useEffect(() => {
    async function fetchBook() {
      console.log("[EditPDF] ▶️ fetchBook start, bookId=", bookId);
      try {
        const res = await fetch(`/api/books/${bookId}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch book data");
        const data = await res.json();
        console.log("[EditPDF] ← Book data:", data);

        console.log("[EditPDF] → POST /api/books/" + bookId + "/prepareSplit");
        const splitResp = await fetch(`/api/books/${bookId}/prepareSplit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: bookId, pages: data.pages }),
        });

        console.log("[EditPDF] ← prepareSplit status:", splitResp.status);
        if (!splitResp.ok) throw new Error("Failed to split images");
        const { pages: splitPages } = await splitResp.json();

        const updatedPages = splitPages.map((p) => ({
          ...p,
          leftX: p.leftX ?? p.x ?? pageConfig.finalWidth / 2 - 100,
          leftY: p.leftY ?? p.y ?? pageConfig.finalHeight / 2 - 25,
          rightX: p.rightX ?? p.x ?? pageConfig.finalWidth / 2 - 100,
          rightY: p.rightY ?? p.y ?? pageConfig.finalHeight / 2 - 25,
          width: p.width ?? 400,
          height: p.height ?? 100,
          fontSize: p.fontSize ?? 16,
          color: p.color ?? "#000000",
          leftText: p.leftText
            ? Array.isArray(p.leftText)
              ? p.leftText
              : p.leftText.split("\n")
            : [],
          rightText: p.rightText
            ? Array.isArray(p.rightText)
              ? p.rightText
              : p.rightText.split("\n")
            : [],
        }));
        setBook({ ...data, pages: updatedPages });
      } catch (err) {
        console.error("Error loading book data:", err);
        toast({
          title: "Error",
          description: "Could not load book data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }
    fetchBook();
  }, [bookId, toast]);

  function buildFlipPages() {
    if (!book) return [];
    const { coverUrl, backCoverUrl } = book;
    const result = [];
    if (coverUrl) {
      result.push({
        id: -1,
        imageUrl: coverUrl,
        content: [],
        isCover: true,
        x: 50,
        y: 50,
        fontSize: 20,
        color: "#ffffff",
      });
    }
    book.pages.forEach((p) => {
      if (!p.isCover && !p.isBackCover) {
        result.push({
          id: p.id * 1000,
          imageUrl: p.leftHalfUrl,
          content: p.leftText || [],
          x: p.leftX ?? pageConfig.finalWidth / 2 - 100,
          y: p.leftY ?? pageConfig.finalHeight / 2 - 25,
          width: p.width,
          height: p.height ?? 100,
          fontSize: p.fontSize ?? 16,
          color: p.leftTextColor ?? "#000000",
          fontFamily: p.leftFontFamily ?? "Nunito",
        });
        result.push({
          id: p.id * 1000 + 1,
          imageUrl: p.rightHalfUrl,
          content: p.rightText || [],
          x: p.rightX ?? pageConfig.finalWidth / 2 - 100,
          y: p.rightY ?? pageConfig.finalHeight / 2 - 25,
          width: p.width,
          height: p.height ?? 100,
          fontSize: p.fontSize ?? 16,
          color: p.rightTextColor ?? "#000000",
          fontFamily: p.rightFontFamily ?? "Nunito",
        });
      }
    });
    if (backCoverUrl) {
      result.push({
        id: -2,
        imageUrl: backCoverUrl,
        content: [],
        isBackCover: true,
        x: 50,
        y: 50,
      });
    }

    return result;
  }

  function buildSpreads(pages) {
    let spreads = [];
    if (pages.length === 0) return spreads;
    let idx = 0;
    if (pages[0].isCover) {
      spreads.push([pages[0]]);
      idx = 1;
    }
    while (idx < pages.length) {
      if (idx === pages.length - 1) {
        spreads.push([pages[idx]]);
        idx++;
      } else {
        spreads.push([pages[idx], pages[idx + 1]]);
        idx += 2;
      }
    }
    return spreads;
  }

  const flipPages = buildFlipPages();
  const spreads = buildSpreads(flipPages);

  function updatePageLayout(fp, newLayout) {
    const origPageId = Math.floor(fp.id / 1000);
    setBook((prev) => {
      if (!prev) return prev;
      const newPages = prev.pages.map((p) => {
        if (p.id === origPageId) {
          if (fp.id % 1000 === 0) {
            return {
              ...p,
              leftX: newLayout.x,
              leftY: newLayout.y,
              width: newLayout.width,
              height: newLayout.height,
            };
          } else {
            return {
              ...p,
              rightX: newLayout.x,
              rightY: newLayout.y,
              width: newLayout.width,
              height: newLayout.height,
            };
          }
        }
        return p;
      });
      return { ...prev, pages: newPages };
    });
  }

  function updatePageText(fp, newValue) {
    const origPageId = Math.floor(fp.id / 1000);
    setBook((prev) => {
      if (!prev) return prev;
      const newPages = prev.pages.map((p) => {
        if (p.id === origPageId) {
          if (Array.isArray(newValue)) {
            if (fp.id % 1000 === 0) {
              return { ...p, leftText: newValue };
            } else {
              return { ...p, rightText: newValue };
            }
          } else {
            return {
              ...p,
              leftText:
                newValue.left !== undefined ? newValue.left : p.leftText,
              rightText:
                newValue.right !== undefined ? newValue.right : p.rightText,
            };
          }
        }
        return p;
      });
      return { ...prev, pages: newPages };
    });
  }

  function handleSelectPage(pageIdx) {
    if (isEditing) return;
    setSelectedPageIdx(pageIdx);
    if (!book) return;
    let pageData;
    book.pages.forEach((p) => {
      if (p.isCover && pageIdx === -1) pageData = p;
      if (p.isBackCover && pageIdx === -2) pageData = p;
      if (p.id * 1000 === pageIdx || p.id * 1000 + 1 === pageIdx) {
        pageData = p;
      }
    });
    if (pageData) {
      setEditingFontSize(pageData.fontSize ?? 16);
      setEditingColor(pageData.color ?? "#000000");
      setEditingFontFamily(pageData.fontFamily ?? "Nunito");
    }
  }

  function handleUpdateStyle(fontSize, color, fontFamily) {
    if (selectedPageIdx === null || !book) return;
    setBook((prev) => {
      if (!prev) return prev;
      const newPages = prev.pages.map((p) => {
        if (p.isCover && selectedPageIdx === -1)
          return { ...p, fontSize, color, fontFamily };
        if (p.isBackCover && selectedPageIdx === -2)
          return { ...p, fontSize, color, fontFamily };

        if (p.id * 1000 === selectedPageIdx)
          return {
            ...p,
            fontSize,
            leftTextColor: color,
            leftFontFamily: fontFamily,
          };
        if (p.id * 1000 + 1 === selectedPageIdx)
          return {
            ...p,
            fontSize,
            rightTextColor: color,
            rightFontFamily: fontFamily,
          };
        return p;
      });
      return { ...prev, pages: newPages };
    });
  }

  const handlePrint = () => {
    setShowShippingForm(true);
  };

  const handleShippingSubmit = async (formData) => {
    try {
      if (user) {
        await apiRequest("POST", "/api/orders", {
          ...formData,
          bookId,
          userId: user.uid,
        });
        setOrderCompleted(true);
        setShowShippingForm(false);
        toast({
          title: "Order placed successfully!",
          description: "Your book will be delivered soon.",
        });
      }
    } catch (error) {
      toast({
        title: "Order failed",
        description: "There was a problem placing your order.",
        variant: "destructive",
      });
    }
  };

  async function handleSaveAndGeneratePDF() {
    if (!book) return;
    setIsGeneratingPdf(true);
    const saveResp = await fetch(`/api/books/${bookId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...book, pages: book.pages }),
    });
    if (!saveResp.ok) {
      toast({
        title: "Error",
        description: "Failed to save book.",
        variant: "destructive",
      });
      return;
    }
    const generateResp = await fetch("/api/pdf/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: book.title,
        pages: book.pages,
        coverUrl: book.coverUrl,
        backCoverUrl: book.backCoverUrl,
      }),
    });
    if (!generateResp.ok) {
      toast({
        title: "Error",
        description: "Failed to generate PDF",
        variant: "destructive",
      });
      return;
    }
    const pdfBlob = await generateResp.blob();
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${book.title}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Success", description: "PDF downloaded." });
    setIsGeneratingPdf(false);
    setLocation(`/book/${bookId}`);
  }

  function goToNextSpread() {
    if (currentSpreadIdx < spreads.length - 1)
      setCurrentSpreadIdx(currentSpreadIdx + 1);
  }
  function goToPrevSpread() {
    if (currentSpreadIdx > 0) setCurrentSpreadIdx(currentSpreadIdx - 1);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-primary"></div>
          <p className="text-lg text-gray-700 font-medium">
            Preparing your book...
          </p>
        </div>
      </div>
    );
  }
  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Book not found</p>
      </div>
    );
  }

  const currentSpread = spreads[currentSpreadIdx];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="flex-grow mx-auto px-4 py-8"
        style={{ minWidth: effectiveMinContainerWidth }}
      >
        <h1 className="text-2xl font-bold mb-4 text-center">{book.title}</h1>

        {/* Spread Viewer */}
        <div
          className="flex justify-center bg-gray-50 p-4 shadow-lg rounded"
          style={{ position: "relative" }}
        >
          <div
            id="spreadContainer"
            className="relative"
            style={{
              width:
                currentSpread.length * pageConfig.finalWidth +
                (currentSpread.length > 1 ? 32 : 0),
              height: pageConfig.finalHeight,
            }}
          >
            <div className="flex gap-0.5">
              {currentSpread.map((fp) => (
                <div
                  key={fp.id}
                  className="relative bg-white overflow-hidden"
                  style={{
                    width: pageConfig.finalWidth,
                    height: pageConfig.finalHeight,
                  }}
                  onClick={(e) => {
                    if (isEditing) return;
                    if (e.target.closest(".resizable-text-editable")) return;
                    handleSelectPage(fp.id);
                  }}
                >
                  <ScalablePreview onScaleChange={setCurrentScale}>
                    <img
                      src={fp.imageUrl}
                      alt=""
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                    <ResizableTextBox
                      x={fp.x ?? 50}
                      y={fp.y ?? 50}
                      width={fp.width ?? 200}
                      height={fp.height ?? 50}
                      fontSize={fp.fontSize ?? 16}
                      color={fp.color ?? "#000000"}
                      fontFamily={fp.fontFamily ?? "Nunito"}
                      lines={fp.content}
                      scale={currentScale}
                      initialSide={fp.id % 1000 === 0 ? "left" : "right"}
                      onUpdate={(newLayout) => updatePageLayout(fp, newLayout)}
                      onTextChange={(newValue) => updatePageText(fp, newValue)}
                      setGlobalIsEditing={setIsEditing}
                    />
                  </ScalablePreview>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 flex flex-col items-center space-y-4">
          <div className="flex w-full justify-between items-center">
            {/* Style Controls */}
            <div className="flex space-x-8 items-center">
              <label className="flex items-center space-x-2">
                <span className="font-medium">Font size:</span>
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={editingFontSize}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditingFontSize(val);
                    handleUpdateStyle(val, editingColor, editingFontFamily);
                  }}
                  className="w-16 border border-gray-300 rounded p-1"
                />
              </label>
              <label className="flex items-center space-x-3">
                <span className="font-medium">Color:</span>
                <input
                  type="color"
                  value={editingColor}
                  onChange={(e) => {
                    setEditingColor(e.target.value);
                    handleUpdateStyle(
                      editingFontSize,
                      e.target.value,
                      editingFontFamily,
                    );
                  }}
                />
              </label>
              <label className="flex items-center space-x-3">
                <span className="font-medium">Font Family:</span>
                <select
                  value={editingFontFamily}
                  onChange={(e) => {
                    setEditingFontFamily(e.target.value);
                    handleUpdateStyle(
                      editingFontSize,
                      editingColor,
                      e.target.value,
                    );
                  }}
                  className="border border-gray-300 rounded p-1"
                >
                  <option value="Nunito">Nunito</option>
                  <option value="Baloo 2">Baloo 2</option>
                  <option value="Chewy">Chewy</option>
                </select>
              </label>
            </div>

            {/* Navigation */}
            <div className="flex space-x-4">
              <Button
                onClick={goToPrevSpread}
                disabled={currentSpreadIdx === 0}
              >
                {"<<"}
              </Button>
              <Button
                onClick={goToNextSpread}
                disabled={currentSpreadIdx === spreads.length - 1}
              >
                {">>"}
              </Button>
            </div>
          </div>
        </div>

        {/* PDF & Print Buttons */}
        <div className="flex flex-col md:flex-row justify-center items-center space-y-4 md:space-y-0 md:space-x-6 mt-12">
          <Button
            variant="default"
            size="lg"
            className="w-full md:w-auto flex items-center justify-center"
            onClick={handleSaveAndGeneratePDF}
            disabled={isGeneratingPdf}
          >
            {isGeneratingPdf ? (
              <>
                <i className="fas fa-spinner mr-2 animate-spin"></i>
                <span>Compiling PDF...</span>
              </>
            ) : (
              <>
                <i className="fas fa-download mr-2"></i>
                <span>Download PDF</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full md:w-auto flex items-center justify-center border-2 border-primary text-primary"
            onClick={handlePrint}
          >
            <i className="fas fa-print mr-2"></i>
            <span>Print & Ship</span>
          </Button>
        </div>

        {showShippingForm && !orderCompleted && (
          <ShippingForm onSubmit={handleShippingSubmit} />
        )}
        {orderCompleted && (
          <div className="flex items-center justify-center bg-green-100 text-green-800 p-4 rounded-lg mb-8 max-w-md mx-auto mt-8">
            <i className="fas fa-check-circle text-green-500 mr-2 text-xl"></i>
            <span>
              Order successfully placed! Your book will be delivered soon.
            </span>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
