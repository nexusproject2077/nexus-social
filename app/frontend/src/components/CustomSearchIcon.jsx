// CustomSearchIcon.jsx - Icône de recherche personnalisée

export default function CustomSearchIcon({ className = "w-6 h-6", color = "currentColor" }) {
  return (
    <svg 
      viewBox="285 445 60 60" 
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>
          {`
            .search-st0 {
              stroke-width: 8px;
            }
            .search-st0, .search-st1, .search-st2 {
              stroke: ${color};
              stroke-miterlimit: 10;
            }
            .search-st0, .search-st2 {
              fill: none;
            }
            .search-st1 {
              fill: ${color};
            }
            .search-st2 {
              stroke-width: 6px;
            }
          `}
        </style>
      </defs>
      <path 
        className="search-st1" 
        d="M339.39,494.09l-14.74-14.74c-.17-.17-.46-.17-.63,0l-1.82,1.82c-.65.65-.9,1.55-.75,2.39.55.57.99,1.26,1.3,2l12.24,12.24c1.22,1.22,3.19,1.22,4.4,0,1.03-1.03,1.03-2.69,0-3.72Z"
      />
      <path 
        className="search-st0" 
        d="M311.44,488.98c-10,0-18.1-8.1-18.1-18.1s8.1-18.1,18.1-18.1,18.1,8.1,18.1,18.1c0,5.76-2.69,10.89-6.88,14.2"
      />
      <circle 
        className="search-st2" 
        cx="310.98" 
        cy="489.06" 
        r=".86"
      />
    </svg>
  );
}
