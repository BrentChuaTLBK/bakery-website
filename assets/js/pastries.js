// Configuration - Update this with your Render API URL
const API_BASE_URL = "https://tlbk-api.onrender.com/api"; // For local testing. Change to: https://tlbk-api.onrender.com/api for production

var urlParams = new URLSearchParams(window.location.search);
var categoryNum = urlParams.get("category");
if (categoryNum == null) {
    categoryNum = -1;
} else {
    categoryNum = parseInt(categoryNum);
}

fetch(`${API_BASE_URL}/findOne`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        collection: "pastries",
        filter: {
            "spec_id": "categories"
        }
    })
})
    .then((response) => response.json())
    .then(async (result) => {
        const docs = result.document;
                let categories = docs.categories;

                var pagenum = urlParams.get("page");
                if (pagenum == null) {
                    pagenum = 1;
                }

                pagenum = parseInt(pagenum);
                let pastriesPerPage = 24;
                let start = (pagenum - 1) * pastriesPerPage;
                let end = start + pastriesPerPage;
                if (end > pastriesPerPage.length) {
                    end = pastriesPerPage.length;
                }


                for (let i = 0; i < categories.length; i++) {
                    let category = categories[i];
                    let id = i.toString();
                    let htmlContent = `<a class="dropdown-item ${i === categoryNum ? 'active' : ''}" href="../../pastries.html?category=` + id + `">` + category + `</a>`;
                    let dropdownMenu = document.querySelector(".categories-dropdown");
                    dropdownMenu.innerHTML += htmlContent; // Use += to append each category
                }

                // GET THE CONTENT

                let categoryFilter = "";
                if (categoryNum !== -1) {
                    let categoryName = categories[categoryNum];
                    categories = [categoryName]

                }

                let modalContent = "";

                let count = 0;

                for (let i = 0; i < categories.length; i++) {
                    let category = categories[i];

                    categoryFilter = {category: category, type: "item"};


                    // INDIVIDUAL STUFF
                    let itemsToAddHTML = "";

                    await fetch(`${API_BASE_URL}/find`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            collection: "pastries",
                            filter: categoryFilter
                        })
                    })
                        .then((response) => response.json())
                        .then((result) => {
                            const docs = result.documents;

                            let placeTitle = false;
                            for (let z = 0; z < docs.length; z++) {

                                if (count >= start && count < end) {
                                    if (!placeTitle) {
                                        let htmlContent = `<div class="row">
                                                <div class="col">
                                                    <h1 class="text-center" style="font-family: Lobster, serif;padding-bottom: 0px;margin-bottom: 26px;">` + category + `</h1>
                                                </div>
                                            </div>`;
                                        let header = document.querySelector(".pastries-db");
                                        header.innerHTML += htmlContent; // Use += to append each category
                                        itemsToAddHTML = `<div class="row gy-3 row-cols-1 row-cols-md-2 row-cols-xl-3">`;
                                        console.log("Placing title");
                                        placeTitle = true;
                                    }
                                    let item = docs[z];
                                    let title = item.title;
                                    let picture = item.picture;
                                    itemsToAddHTML += `<div class="col-6 col-md-4 col-lg-3 col-xl-3">
                    <div class="text-center"><a href="#" data-bs-target="#pictureModal${i}-${z}" data-bs-toggle="modal"><img class="rounded img-fluid fit-cover" style="height: 200px;width: 200px;" src="${picture}" width="330" height="400"></a>
                        <div class="py-2">
                            <h6 class="text-center">${title}</h6>
                        </div>
                    </div>
                </div>`;
                                    modalContent += `<div id="pictureModal${i}-${z}" class="modal fade" role="dialog" tabindex="-1" aria-labelledby="pictureModalLabel" aria-hidden="true">
                                                    <div class="modal-dialog modal-dialog-centered" role="document">
                                                        <div class="modal-content">
                                                            <div class="modal-header"><button class="btn-close" aria-label="Close" data-bs-dismiss="modal" type="button"></button></div>
                                                            <div class="modal-body" style="align-self: center"><img class="img-fluid" alt="Picture" src="${picture}" /></div>
                                                        </div>
                                                    </div>
                                                </div>`;
                                }

                                count++;
                            }
                            document.querySelector(".pastries-db").innerHTML += itemsToAddHTML + `</div>`;

                        })
                        .catch((error) => {
                            console.error("An error occurred:", error);
                            $(".loading").hide();
                        });

                    document.querySelector(".pastries-db").innerHTML += modalContent;

                }

                let totalPages = Math.ceil(count / pastriesPerPage);
                let maxVisiblePages = 5;
                let startPage = Math.max(1, pagenum - Math.floor(maxVisiblePages / 2));
                let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

                // Adjust startPage if endPage is at the end
                if (endPage - startPage < maxVisiblePages - 1) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                }

                let paginationHtml = `<li class="page-item ${pagenum === 1 ? 'disabled' : ''}">
                                                    <a class="page-link" href="?page=${pagenum - 1}${categoryNum !== -1 ? "&category=" + categoryNum : ""}" aria-label="Previous">
                                                        <span aria-hidden="true" style="color: var(--bs-body-color);">«</span>
                                                    </a>
                                                </li>`;

                if (startPage > 1) {
                    paginationHtml += `<li class="page-item" style="color: var(--bs-body-color);">
                                            <a class="page-link" style="color: var(--bs-body-color);" href="?page=1${categoryNum !== -1 ? "&category=" + categoryNum : ""}">1</a>
                                        </li>`;
                    if (startPage > 2) {
                        paginationHtml += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
                    }
                }

                for (let i = startPage; i <= endPage; i++) {
                    paginationHtml += `<li class="page-item ${i === pagenum ? 'active' : ''}" style="color: var(--bs-body-color);">
                                            <a class="page-link" style="color: var(--bs-body-color);" href="?page=${i}${categoryNum !== -1 ? "&category=" + categoryNum : ""}">${i}</a>
                                        </li>`;
                }

                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                        paginationHtml += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
                    }
                    paginationHtml += `<li class="page-item" style="color: var(--bs-body-color);">
                                            <a class="page-link" style="color: var(--bs-body-color);" href="?page=${totalPages}${categoryNum !== -1 ? "&category=" + categoryNum : ""}">${totalPages}</a>
                                        </li>`;
                }

                paginationHtml += `<li class="page-item ${pagenum === totalPages ? 'disabled' : ''}">
                    <a class="page-link" href="?page=${pagenum + 1}${categoryNum !== -1 ? "&category=" + categoryNum : ""}" aria-label="Next">
                        <span aria-hidden="true" style="color: var(--bs-body-color);">»</span>
                    </a>
                </li>`;

                document.querySelector(".pagination-pastries").innerHTML = paginationHtml;
                $(".loading").hide();
            })
            .catch((e) => {
                console.log(e);
                $(".loading").hide();
            });